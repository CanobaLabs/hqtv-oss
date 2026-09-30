import User from '../../common/types/user';

function generateBasicUser(user: User) {
    return {
        id: user.id,
        name: user.dispName,
        avatarUrl: user.avatarUrl
    }
}

export default generateBasicUser;
