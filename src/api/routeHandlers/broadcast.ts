import { Op } from 'sequelize';
import Account from '../../common/database/userModels/account';
import Broadcast from '../../common/database/eventModels/broadcast';
import redis from '../../common/redisClient';
import getFriendIds from '../../common/utils/getFriendIds';
import { getUser, bulkGetUsers } from '../../common/utils/userGetters';
import rGameKey from '../../websocket/wsTypes/redisGameKeys';
import runGameCommand from '../../websocket/gameMasterHandlers/runGameCommand';
import logger from '../../common/logger';
import Audit from '../../common/database/adminModels/audit';
import { commandOptions } from 'redis';
import getGeneralConfig from '../utils/getGeneralConfig';
import HqError from '../../common/hqError';
import { wsServers } from '../../websocket/wsServers';
import { getQuestion, getPuzzle } from '../../websocket/helpers/gameDataGetters';

export async function getViewers(broadcastIdStr: string = '0', mode: string = 'playing', offset: number = 0, limitOverride?: string) {
	const now = Date.now();
    let data: { userId: number; username: string; avatarUrl: string | null; isConnected: boolean; isAlive: boolean; ts: number; }[] = [];
    
    const resultKey = `viewerResults:${mode}:${offset}`;
    const [lastViewersRefresh, cachedResult] = await Promise.all([
        redis.get(rGameKey(+broadcastIdStr).lastViewersRefresh),
        redis.get(resultKey)
    ]);
    const pExAt = (+(lastViewersRefresh ?? now.toString())) + 4500; // expire the result when viewers are refreshed
    const refresh = await redis.set(resultKey + '_lock', now, { PXAT: pExAt, NX: true }); // prevent fetching more than once at a time
    if (refresh) {
        const viewersIds = await redis.zRange(rGameKey(+broadcastIdStr).viewers(mode), '-', '+', { BY: 'LEX', LIMIT: { offset: offset, count: +(limitOverride ?? "20") } });
        if (viewersIds.length > 0) {
            const viewerUsers = await bulkGetUsers(viewersIds.map(idStr => +idStr));
            data = viewerUsers.map(usr => {
                return {
                    userId: usr.id,
                    username: usr.dispName,
                    avatarUrl: usr.avatarUrl,
                    isConnected: false,
                    isPro: usr.booster,
                    isAlive: false,
                    ts: 1
                }
            });
        }
        const config = await getGeneralConfig();
        await redis.set(resultKey, JSON.stringify(data), { EX: config.broadcastCacheExpirySec }); // expiry here not relied upon for anything
    } else if (cachedResult) {
        data = JSON.parse(cachedResult);
    }
    return data;
}

export async function getViewersWhoAreFriendsOfUser(userId: number, broadcastIdStr: string = '') {
    const data: {
        userId: number,
        username: string,
        avatarUrl: string | null,
        viewerState: 'playing' | 'watching' | 'notInGame'
    }[] = [];
    const friendIds = (await getFriendIds(userId, true)).filter(id => id !== userId);
    const friendUsers = await Account.findAll({ where: { id: { [Op.in]: friendIds } } });
    let promises = [];
    for (const user of friendUsers) {
        const multi = redis.multi();
        multi.zRank(rGameKey(+broadcastIdStr).playingViewers, user.id.toString());
        multi.zRank(rGameKey(+broadcastIdStr).watchingViewers, user.id.toString());

        promises.push(
            (async () => {
                const v = await multi.exec();
                const [playing, watching] = v;
                let viewerState: typeof data[0]['viewerState'] = 'notInGame';
                if (playing) {
                    viewerState = 'playing'
                } else if (watching) {
                    viewerState = 'watching';
                }

                data.push({
                    userId: user.id,
                    username: user.name,
                    avatarUrl: user.avatarUrl,
                    viewerState: viewerState
                });
            })
        );
    }
    await Promise.all(promises);

    data.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

    return {
        viewers: data.filter(v => v.viewerState !== 'notInGame' && v.userId !== userId),
        notInGame: data.filter(v => v.viewerState === 'notInGame' && v.userId !== userId)
    }
}

export async function kickPlayerFromGame(broadcastIdStr: string, kickUserIdStr: string, adminId: number) {
    await runGameCommand('kick', +broadcastIdStr, [kickUserIdStr]);
    logger.info(`Player kick. AdminID=${adminId}, TargetID=${kickUserIdStr}`);
    await Audit.create({
        to: broadcastIdStr,
        toType: 'broadcast',
        subTo: kickUserIdStr,
        subToType: 'account',
        from: adminId,
        fromType: 'account',
        action: 'kick_player',
        description: 'Kicked',
    });
    return {};
}

export async function getChat(broadcastIdStr: string = '0') {
	const chatLog = await redis.xRead(commandOptions({ isolated: true }), [
        {
            key: 'broadcast:' + broadcastIdStr + ":chat",
            id: '0-0'
        }], {
            COUNT: 1000
        });
    if (chatLog == null || chatLog.length == 0) return [];
    const firstStream = chatLog[0];
    if (!firstStream || !firstStream.messages) return [];
    return firstStream.messages.map(message => {
        let user = message.message.user != "admin" ? JSON.parse(message.message.user) : "admin";
        return {
            id: message.id,
            user: user == "admin" ? "admin" : {
                id: user.id,
                originalName: user.originalName,
                name: user.name,
                avatarUrl: user.avatarUrl,
                deviceEmoji: user?.deviceEmoji
            },
            message: message.message.message
        }
    });
}

export async function getQuestionAnswerCounts(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    
    if (!question) {
        throw new HqError('Question not found', 404, 404);
    }
    
    if (question.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!question.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const answerCounts: { [answerId: number]: number } = {};
    const keepPlayingCounts: { [answerId: number]: number } = {};
    
    const playerAnswers = await Promise.all(
        question.answers.map(a =>
            redis.zRange(rGameKey(broadcastId).question(questionNumber).playerAnswers, a.id, a.id, { BY: 'SCORE' })
        )
    );
    
    const keepPlayingAnswers = await Promise.all(
        question.answers.map(a =>
            redis.zRange(rGameKey(broadcastId).question(questionNumber).keepPlayingAnswers, a.id, a.id, { BY: 'SCORE' })
        )
    );
    
    question.answers.forEach((answer, index) => {
        answerCounts[answer.id] = playerAnswers[index].length;
        keepPlayingCounts[answer.id] = keepPlayingAnswers[index].length;
    });

    let eliminated = 0;
    let saved = 0;

    const correctAnswer = question.answers.find(a => a.correct);
    if (correctAnswer) {
        const getQuestionStatusHelper = (await import('../../websocket/helpers/getQuestionStatus')).default;
        const questionStatus = await getQuestionStatusHelper(broadcastId, question.id);
        const questionFinished = questionStatus === 'explanation' || questionStatus === 'results' || questionStatus === 'complete';

        const allWrongPlayerIds: string[] = [];
        question.answers.forEach((answer, index) => {
            if (!answer.correct) {
                allWrongPlayerIds.push(...playerAnswers[index]);
            }
        });

        const [roundPlaying, correctPlayers] = await Promise.all([
            questionFinished ? redis.sMembers(rGameKey(broadcastId).question(questionNumber).roundPlaying) : Promise.resolve([]),
            questionFinished ? redis.sMembers(rGameKey(broadcastId).question(questionNumber).correctPlayers) : Promise.resolve([])
        ]);

        const correctSet = new Set(correctPlayers);

        let playersToCheck: string[];
        if (questionFinished) {
            playersToCheck = roundPlaying.filter(playerId => !correctSet.has(playerId));
        } else {
            playersToCheck = allWrongPlayerIds;
        }

        if (playersToCheck.length > 0) {
            const gameInfo = await (await import('../../websocket/helpers/getGameInfo')).default(broadcastId);
            const savedByFreePassSet = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByFreePass);
            const savedByFreePass = new Set(savedByFreePassSet);
            
            if (savedByFreePassSet.length === 0 && gameInfo.seasonEnabled) {
                const getSeason = (await import('../../api/utils/getSeason')).default;
                const season = await getSeason();
                const questionLevel = season?.levels.find(l => l.level === questionNumber);
                if (questionLevel) {
                    const allPlayerPointsStr = await redis.hmGet(rGameKey(broadcastId).totalSeasonXp, playersToCheck);
                    playersToCheck.forEach((playerId, i) => {
                        const plrPoints = +allPlayerPointsStr[i];
                        if (plrPoints >= questionLevel.minPoints) {
                            savedByFreePass.add(playerId);
                        }
                    });
                }
            }

            playersToCheck.forEach(playerId => {
                if (savedByFreePass.has(playerId)) {
                    saved++;
                } else {
                    eliminated++;
                }
            });
        }
    }
    
    return {
        questionId: question.id,
        questionNumber: questionNumber,
        answerCounts: answerCounts,
        keepPlayingCounts: keepPlayingCounts,
        eliminated: eliminated,
        saved: saved
    };
}

export async function getQuestionExtraLifeCount(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    const puzzle = question ? null : await getPuzzle(broadcastId, questionNumber);
    
    const item = question || puzzle;
    if (!item) {
        throw new HqError('Question or puzzle not found', 404, 404);
    }
    
    if (item.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!item.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const usedLifeCount = await redis.sCard(rGameKey(broadcastId).question(questionNumber).usedLife);
    
    return {
        questionId: item.id,
        questionNumber: questionNumber,
        count: usedLifeCount
    };
}

export async function getQuestionAnswerPlayers(broadcastIdStr: string, questionIdStr: string, answerIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    const answerId = +answerIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    if (!answerId || isNaN(answerId) || answerId < 1) {
        throw new HqError('Invalid answer ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    
    if (!question) {
        throw new HqError('Question not found', 404, 404);
    }
    
    if (question.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!question.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const answerExists = question.answers.some(a => a.id === answerId);
    if (!answerExists) {
        throw new HqError('Answer not found for this question', 404, 404);
    }
    
    const playerIds = await redis.zRange(rGameKey(broadcastId).question(questionNumber).playerAnswers, answerId, answerId, { BY: 'SCORE' });
    
    if (playerIds.length === 0) {
        return {
            questionId: questionId,
            questionNumber: questionNumber,
            answerId: answerId,
            players: []
        };
    }
    
    const [users, revivedPlayerIds] = await Promise.all([
        bulkGetUsers(playerIds.map(id => +id)),
        redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByStaff)
    ]);
    
    const revivedSet = new Set(revivedPlayerIds);
    
    const players = users.map(user => ({
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl,
        revived: revivedSet.has(user.id.toString())
    }));
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        answerId: answerId,
        players: players
    };
}

export async function getQuestionExtraLifePlayers(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    const puzzle = question ? null : await getPuzzle(broadcastId, questionNumber);
    
    const item = question || puzzle;
    if (!item) {
        throw new HqError('Question or puzzle not found', 404, 404);
    }
    
    if (item.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!item.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const playerIds = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).usedLife);
    
    if (playerIds.length === 0) {
        return {
            questionId: questionId,
            questionNumber: questionNumber,
            players: []
        };
    }
    
    const users = await bulkGetUsers(playerIds.map(id => +id));
    
    const players = users.map(user => ({
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl
    }));
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        players: players
    };
}

export async function getQuestionEliminatedPlayers(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    
    if (!question) {
        throw new HqError('Question not found', 404, 404);
    }
    
    if (question.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!question.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const [roundPlaying, correctPlayers, savedByFreePass] = await Promise.all([
        redis.sMembers(rGameKey(broadcastId).question(questionNumber).roundPlaying),
        redis.sMembers(rGameKey(broadcastId).question(questionNumber).correctPlayers),
        redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByFreePass)
    ]);
    
    const correctSet = new Set(correctPlayers);
    const savedSet = new Set(savedByFreePass);
    
    const eliminatedPlayerIds = roundPlaying.filter(playerId => 
        !correctSet.has(playerId) && !savedSet.has(playerId)
    );
    
    if (eliminatedPlayerIds.length === 0) {
        return {
            questionId: questionId,
            questionNumber: questionNumber,
            players: []
        };
    }
    
    const users = await bulkGetUsers(eliminatedPlayerIds.map(id => +id));
    
    const players = users.map(user => ({
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl
    }));
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        players: players
    };
}

export async function getQuestionSavedPlayers(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    
    if (!question) {
        throw new HqError('Question not found', 404, 404);
    }
    
    if (question.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!question.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const savedPlayerIds = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByFreePass);
    
    if (savedPlayerIds.length === 0) {
        return {
            questionId: questionId,
            questionNumber: questionNumber,
            players: []
        };
    }
    
    const users = await bulkGetUsers(savedPlayerIds.map(id => +id));
    
    const players = users.map(user => ({
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl
    }));
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        players: players
    };
}

export async function getCheckpointInfo(broadcastIdStr: string, checkpointIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const checkpointId = checkpointIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!checkpointId || typeof checkpointId !== 'string' || checkpointId.trim() === '') {
        throw new HqError('Invalid checkpoint ID', 400, 400);
    }
    
    const checkpointMethods = (await import('../../websocket/helpers/CheckpointMethods')).default;
    const { currentCheckpoint } = await checkpointMethods(broadcastId).getCheckpointInfo(checkpointId);
    
    if (!currentCheckpoint) {
        throw new HqError('Checkpoint not found in this broadcast', 404, 404);
    }
    
    const getCheckpointStatusHelper = (await import('../../websocket/helpers/getCheckpointStatus')).default;
    const status = await getCheckpointStatusHelper(broadcastId, checkpointId);
    
    if (status === 'notStarted') {
        throw new HqError('Checkpoint has not been started yet', 404, 404);
    }
    
    const eligiblePlayersCount = currentCheckpoint.eligiblePlayersCount ? +currentCheckpoint.eligiblePlayersCount : await redis.sCard(rGameKey(broadcastId).inTheGame);
    
    return {
        checkpointId: checkpointId,
        prizeOfferCents: currentCheckpoint.prizeOfferCents ? +currentCheckpoint.prizeOfferCents : 0,
        prizeOfferPoints: currentCheckpoint.prizeOfferPoints ? +currentCheckpoint.prizeOfferPoints : 0,
        eligiblePlayersCount: eligiblePlayersCount
    };
}

export async function getCheckpointTakers(broadcastIdStr: string, checkpointIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const checkpointId = checkpointIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!checkpointId || typeof checkpointId !== 'string' || checkpointId.trim() === '') {
        throw new HqError('Invalid checkpoint ID', 400, 400);
    }
    
    const checkpointMethods = (await import('../../websocket/helpers/CheckpointMethods')).default;
    const { currentCheckpoint } = await checkpointMethods(broadcastId).getCheckpointInfo(checkpointId);
    
    if (!currentCheckpoint) {
        throw new HqError('Checkpoint not found in this broadcast', 404, 404);
    }
    
    const [prizes, points] = await Promise.all([
        redis.hGetAll(rGameKey(broadcastId).checkpoint(checkpointId).prizes),
        redis.hGetAll(rGameKey(broadcastId).checkpoint(checkpointId).points)
    ]);
    
    if (!prizes || Object.keys(prizes).length === 0) {
        return {
            checkpointId: checkpointId,
            players: []
        };
    }
    
    const playerIds = Object.keys(prizes).map(id => +id);
    const users = await bulkGetUsers(playerIds);
    
    const players = users.map(user => ({
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl,
        prizeCents: prizes[user.id.toString()] ? +prizes[user.id.toString()] : 0,
        prizePoints: points?.[user.id.toString()] ? +points[user.id.toString()] : 0
    }));
    
    return {
        checkpointId: checkpointId,
        players: players
    };
}

export async function getCheckpointStatus(broadcastIdStr: string, checkpointIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const checkpointId = checkpointIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!checkpointId || typeof checkpointId !== 'string' || checkpointId.trim() === '') {
        throw new HqError('Invalid checkpoint ID', 400, 400);
    }
    
    const checkpointMethods = (await import('../../websocket/helpers/CheckpointMethods')).default;
    const { currentCheckpoint } = await checkpointMethods(broadcastId).getCheckpointInfo(checkpointId);
    
    if (!currentCheckpoint) {
        throw new HqError('Checkpoint not found in this broadcast', 404, 404);
    }
    
    const getCheckpointStatusHelper = (await import('../../websocket/helpers/getCheckpointStatus')).default;
    const status = await getCheckpointStatusHelper(broadcastId, checkpointId);
    
    return {
        checkpointId: checkpointId,
        status: status
    };
}

export async function getWinners(broadcastIdStr: string) {
    const broadcastId = +broadcastIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    const winnersStr = await redis.get(rGameKey(broadcastId).winners);
    
    if (!winnersStr) {
        return {
            winners: []
        };
    }
    
    const winners = JSON.parse(winnersStr);
    
    return {
        winners: winners
    };
}

export async function getWinnersStatus(broadcastIdStr: string) {
    const broadcastId = +broadcastIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    const getWinnersStatusHelper = (await import('../../websocket/helpers/getWinnersStatus')).default;
    const status = await getWinnersStatusHelper(broadcastId);
    
    return {
        status: status
    };
}

export async function getQuestionStatus(broadcastIdStr: string, questionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const getQuestionStatusHelper = (await import('../../websocket/helpers/getQuestionStatus')).default;
    const status = await getQuestionStatusHelper(broadcastId, questionId);
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        status: status
    };
}

export async function getSurveyStatus(broadcastIdStr: string, surveyQuestionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const surveyQuestionId = surveyQuestionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!surveyQuestionId) {
        throw new HqError('Invalid survey question ID', 400, 400);
    }
    
    const allSurveyQuestionIds = await redis.lRange(rGameKey(broadcastId).allSurveyQuestionIds, 0, -1);
    const surveyExists = allSurveyQuestionIds.includes(surveyQuestionId);
    
    if (!surveyExists) {
        throw new HqError('Survey question not found in this broadcast', 404, 404);
    }
    
    const getSurveyStatusHelper = (await import('../../websocket/helpers/getSurveyStatus')).default;
    const status = await getSurveyStatusHelper(broadcastId, surveyQuestionId);
    
    return {
        surveyQuestionId: surveyQuestionId,
        status: status
    };
}

export async function getSurveyCounts(broadcastIdStr: string, surveyQuestionIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const surveyQuestionId = surveyQuestionIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!surveyQuestionId) {
        throw new HqError('Invalid survey question ID', 400, 400);
    }
    
    const allSurveyQuestionIds = await redis.lRange(rGameKey(broadcastId).allSurveyQuestionIds, 0, -1);
    const surveyExists = allSurveyQuestionIds.includes(surveyQuestionId);
    
    if (!surveyExists) {
        throw new HqError('Survey question not found in this broadcast', 404, 404);
    }
    
    const getSurveyQuestionHelper = (await import('../../websocket/helpers/surveyQuestionMethods')).getSurveyQuestion;
    const surveyQuestion = await getSurveyQuestionHelper(broadcastId, surveyQuestionId);
    
    if (!surveyQuestion.startTime) {
        throw new HqError('Survey question has not been asked yet', 404, 404);
    }
    
    const answerCounts: { [answerId: string]: number } = {};
    
    const voteCounts = await Promise.all(
        surveyQuestion.answers.map(a =>
            redis.sCard(rGameKey(broadcastId).surveyAnswerVotes(surveyQuestionId, a.surveyAnswerId))
        )
    );

    surveyQuestion.answers.forEach((answer, index) => {
        answerCounts[answer.surveyAnswerId] = voteCounts[index];
    });
    
    return {
        surveyQuestionId: surveyQuestionId,
        answerCounts: answerCounts
    };
}

export async function getWheelStatus(broadcastIdStr: string) {
    const broadcastId = +broadcastIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    const getWheelStatusHelper = (await import('../../websocket/helpers/getWheelStatus')).default;
    const status = await getWheelStatusHelper(broadcastId);
    
    return {
        status: status
    };
}

export async function getWheelSuperSpinCount(broadcastIdStr: string) {
    const broadcastId = +broadcastIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    const usedSuperSpinCount = await redis.sCard(rGameKey(broadcastId).usedSuperSpin);
    
    return {
        count: usedSuperSpinCount
    };
}

export async function revivePlayersByAnswer(broadcastIdStr: string, questionIdStr: string, answerIdStr: string) {
    const broadcastId = +broadcastIdStr;
    const questionId = +questionIdStr;
    const answerId = +answerIdStr;
    
    if (!broadcastId || isNaN(broadcastId)) {
        throw new HqError('Invalid broadcast ID', 400, 400);
    }
    
    if (!questionId || isNaN(questionId) || questionId < 1) {
        throw new HqError('Invalid question ID', 400, 400);
    }
    
    if (!answerId || isNaN(answerId) || answerId < 1) {
        throw new HqError('Invalid answer ID', 400, 400);
    }
    
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        throw new HqError('Question not found in this broadcast', 404, 404);
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    
    if (!question) {
        throw new HqError('Question not found', 404, 404);
    }
    
    if (question.id !== questionId) {
        throw new HqError('Question ID mismatch', 404, 404);
    }
    
    if (!question.askTime) {
        throw new HqError('Question has not been asked yet', 404, 404);
    }
    
    const answerExists = question.answers.some(a => a.id === answerId);
    if (!answerExists) {
        throw new HqError('Answer not found for this question', 404, 404);
    }
    
    const playerIds = await redis.zRange(rGameKey(broadcastId).question(questionNumber).playerAnswers, answerId, answerId, { BY: 'SCORE' });
    
    if (playerIds.length === 0) {
        return {
            questionId: questionId,
            questionNumber: questionNumber,
            answerId: answerId,
            revivedCount: 0,
            revived: []
        };
    }
    
    const result = await runGameCommand('revivePlayers', broadcastId, playerIds) as { revived: string[] };
    
    return {
        questionId: questionId,
        questionNumber: questionNumber,
        answerId: answerId,
        revivedCount: result.revived.length,
        revived: result.revived
    };
}

export async function listRunningBroadcasts() {
    const runningBroadcasts = await Broadcast.findAll({
        where: { ended: null },
        order: [['started', 'DESC']],
        raw: true
    });
    
    return runningBroadcasts.map(broadcast => ({
        broadcastId: broadcast.broadcastId,
        gameId: broadcast.gameId,
        started: broadcast.started,
        rehearsal: broadcast.rehearsal,
        forReal: broadcast.forReal,
        active: wsServers[broadcast.broadcastId]?.active ?? false
    }));
}
