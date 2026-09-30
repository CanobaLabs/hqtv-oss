import User from '../../../common/types/user';
import getProfileFullPrivate from './getProfileFullPrivate';
import getProfileFullPublic from './getProfileFullPublic';

async function getProfileFull(profileUser?: User, requestingUser?: User) {
    const requestingSelf = requestingUser?.id === profileUser?.id;
    if (requestingSelf || requestingUser?.admin) {
        return await getProfileFullPrivate(profileUser);
    } else {
        return await getProfileFullPublic(profileUser);
    }
}

export default getProfileFull;
