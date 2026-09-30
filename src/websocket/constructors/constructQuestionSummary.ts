import getSeason from '../../api/utils/getSeason';
import redis from '../../common/redisClient';
import User from '../../common/types/user';
import getPointsToNextLevel from '../../common/utils/getPointsToNextLevel';
import levelFromPoints from '../../common/utils/levelFromPoints';
import { bulkGetUsers } from '../../common/utils/userGetters';
import { getBulkCurrentXp, getBulkFriendIdsAsStr, getBulkLivesRemaining, getBulkPlayingStatus, getBulkSubmittedAnswerId, levelsWithMaxPoints } from '../helpers/bulkPlayerMethods';
import checkpointMethods from '../helpers/CheckpointMethods';
import { getQuestion } from '../helpers/gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import HqQuestionSummary from '../wsMessageTypes/HqQuestionSummary';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructQuestionSummary(gameInfo: WsGameInfo) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, questionNumber, seasonEnabled } = gameInfo;

        const [
            question, checkpointInfo, season,
            bulkSubmittedAnswerIds, bulkPlayingStatus, bulkLivesRemaining, bulkCurrentXp, bulkFriendIds,
            bulkWasJustIn, bulkGotItRight, bulkSavedByFreePass, bulkSavedByWinnersCap, bulkUsedLife, bulkPointsEarned
        ] = await Promise.all([
            getQuestion(broadcastId).then(q => q as NonNullable<typeof q>),
            checkpointMethods(broadcastId).getCheckpointInfo(),
            seasonEnabled ? getSeason() : null,
            getBulkSubmittedAnswerId(broadcastId, playerIds, questionNumber),
            getBulkPlayingStatus(broadcastId, playerIds),
            getBulkLivesRemaining(gameInfo, playerIds),
            getBulkCurrentXp(broadcastId, playerIds),
            getBulkFriendIdsAsStr(playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).roundPlaying, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).correctOverall, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).savedByFreePass, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).savedByWinnersCap, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).usedLife, playerIds),
            redis.hmGet(rGameKey(broadcastId).question(questionNumber).pointsEarned, playerIds)
        ]);
        const answerCounts = question.answers.map(a => ({
            answerId: a.id,
            answer: a.text,
            correct: a.correct,
            count: question.answerCounts![a.id]
        }));
        
        const bulkFriendAnswerIds = await Promise.all(
            bulkFriendIds.map(plrFrIds => {
                if (plrFrIds.length > 0) {
                    return redis.zmScore(rGameKey(broadcastId).question(questionNumber).playerAnswers, plrFrIds);
                } else {
                    return [];
                }
            })
        );
        // there will be many friend overlaps. this ensures it only runs once per friend user
        const friendUsersMap: { [userId: number]: User; } = {};
        const friendUserIds = new Set<string>(bulkFriendIds.flatMap(plrFrIds => plrFrIds));
        const friendUsers = await bulkGetUsers([...friendUserIds].map(plrId => +plrId));
        friendUsers.forEach(u => friendUsersMap[u.id] = u);

        return playerIds.map((_, i) => {
            const submittedAnswerId = bulkSubmittedAnswerIds[i];
            const playedRound = bulkWasJustIn[i];
            const playingStatus = bulkPlayingStatus[i];
            const gotItRight = bulkGotItRight[i];
            const savedByFreePass = bulkSavedByFreePass[i];
            const savedByWinnersCap = bulkSavedByWinnersCap[i];
            const livesRemaining = bulkLivesRemaining[i];
            const usedLife = bulkUsedLife[i];
            const currentPoints = bulkCurrentXp[i];
            const roundPointsEarned = +(bulkPointsEarned[i] ?? 0);
            const friendIds = bulkFriendIds[i];
            const friendAnswerIds = bulkFriendAnswerIds[i];
            
            const friendsAnswers: { [answerId: string]: {
                answerId: number;
                users: { userId: number; username: string; avatarUrl: string | null; }[];
            }; } = {};
            friendIds.forEach((frId, ii) => {
                const answerId = friendAnswerIds[ii];
                const frUser = friendUsersMap[+frId];
                if (!answerId) return; // didn't answer
                if (!friendsAnswers[answerId]) {
                    friendsAnswers[answerId] = { answerId: +answerId, users: [] };
                }
                friendsAnswers[answerId].users.push({ userId: frUser.id, username: frUser.dispName, avatarUrl: frUser.avatarUrl });
            });
            
            const { level: levelNumber } = levelFromPoints(currentPoints, season?.levels ?? []);
            return {
                type: 'questionSummary',
                questionId: question.id,
                questionNumber: questionNumber,
                question: question.question,
                answerCounts: answerCounts,
                advancingPlayersCount: question.advancingCount!,
                eliminatedPlayersCount: question.eliminatedCount!,
                nextCheckpointIn: checkpointInfo.nextCheckpoints[0] ? (
                    (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) >= 0 ? 
                        (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) :
                        null
                ): null,
                questionMedia: question.media,
                playingStatus: playingStatus,
                youGotItRight: !!(gotItRight || savedByFreePass || savedByWinnersCap),
                yourAnswerId: submittedAnswerId,
                savedByExtraLife: !!usedLife,
                extraLivesRemaining: livesRemaining,
                pointsEarned: roundPointsEarned,
                wasJustInTheGame: !!playedRound,
                friendsAnswers: Object.values(friendsAnswers),
                buyBackInAvailable: false,
                availableProductIds: [],
                achievements: [],
                freePass: savedByFreePass ? { message: `Your *Level ${levelNumber}* Free Pass saved you!` } : undefined,
                seasonXp: (season && roundPointsEarned > 0) ? {
                    name: season.seasonId,
                    currentLevelNumber: levelNumber,
                    currentPoints: currentPoints,
                    previousPoints: currentPoints - roundPointsEarned,
                    remainingPoints: getPointsToNextLevel(season.levels, currentPoints, levelNumber),
                    minimumRotationDegrees: 15,
                    levels: levelsWithMaxPoints(season.levels, currentPoints)
                } : undefined
            } as HqQuestionSummary;
        });
    }
}

export default constructQuestionSummary;
