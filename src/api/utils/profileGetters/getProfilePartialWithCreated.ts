import User from '../../../common/types/user';
import ApiProfilePartialWithCreated from '../../responseTypes/ApiProfilePartialWithCreated';
import getProfilePartial from './getProfilePartial';

function getProfilePartialWithCreated(user?: User): ApiProfilePartialWithCreated {
    return {
        ...getProfilePartial(user),
        created: (user?.created ?? new Date()).toISOString()
    }
}

export default getProfilePartialWithCreated;
