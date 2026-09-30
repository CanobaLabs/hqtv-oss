import getSeason from '../../api/utils/getSeason';
import levelFromPoints from '../../common/utils/levelFromPoints';
import { getBulkCanUseEraser, getBulkCurrentXp, getBulkPlayingStatus, getBulkSubmittedAnswerId } from '../helpers/bulkPlayerMethods';
import checkpointMethods from '../helpers/CheckpointMethods';
import { getQuestion, getQuestionTimeLeft } from '../helpers/gameDataGetters';
import getKeepPlayingConfig from '../helpers/getKeepPlayingConfig';
import HqQuestion from '../wsMessageTypes/HqQuestion';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructQuestion(gameInfo: WsGameInfo, questionStart?: boolean) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, questionNumber, questionCount, seasonEnabled } = gameInfo;
        const [
            question, checkpointInfo, season, { enabled: kpEnabled },
            bulkPlayingStatus, bulkAbleToUseEraser, bulkSubmittedAnswerIds, bulkCurrentXp
        ] = await Promise.all([
            getQuestion(broadcastId).then(q => q as NonNullable<typeof q>),
            checkpointMethods(broadcastId).getCheckpointInfo(),
            seasonEnabled ? getSeason() : null,
            getKeepPlayingConfig(),
            getBulkPlayingStatus(broadcastId, playerIds),
            getBulkCanUseEraser(gameInfo, playerIds),
            getBulkSubmittedAnswerId(broadcastId, playerIds, questionNumber),
            getBulkCurrentXp(broadcastId, playerIds)
        ]);
        const timeLeftMs = questionStart ? question.totalTimeMs : getQuestionTimeLeft(question.totalTimeMs, question.askTime!);
        const askTime = new Date(question.askTime!).toISOString();
        const answers = question.answers.map(a => ({
            answerId: a.id,
            text: a.text
        }));
        
        return playerIds.map((_, i) => {
            const playingStatus = bulkPlayingStatus[i];
            const ableToUseEraser = bulkAbleToUseEraser[i];
            const submittedAnswerId = bulkSubmittedAnswerIds[i];
            const currentXp = bulkCurrentXp[i];
            const { level } = levelFromPoints(currentXp, season?.levels ?? []);
            return {
                type: 'question',
                totalTimeMs: question.totalTimeMs,
                timeLeftMs: timeLeftMs,
                questionId: question.id,
                question: question.question,
                category: '',
                answers: answers,
                questionNumber: questionNumber,
                questionCount: questionCount,
                nextCheckpointIn: checkpointInfo.nextCheckpoints[0] ? (
                    (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) >= 0 ? 
                        (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) :
                        null
                ): null,
                askTime: askTime,
                erase1: ableToUseEraser,
                extraLifeEligible: question.lifeEligible,
                freePassAvailable: level >= questionNumber,
                questionMedia: question.media,
                playingStatus: playingStatus,
                submittedAnswerId: submittedAnswerId,
                keepPlaying: !!(playingStatus != 'playing' && kpEnabled)
            } as HqQuestion;
        });
    }
}

export default constructQuestion;
