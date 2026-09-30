import User from '../../common/types/user';
import HqAnswered from '../wsMessageTypes/HqAnswered';

function constructAnswered(user: User, questionId: number, submittedAnswerId: number) {
    return {
        type: 'answered',
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl,
        answerIds: [],
        questionId: questionId,
        answerId: submittedAnswerId
    } as HqAnswered;
}

export default constructAnswered;
