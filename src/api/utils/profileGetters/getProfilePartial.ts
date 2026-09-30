import User from '../../../common/types/user';
import defaultAvatars from '../../defaultAvatars';
import ApiProfilePartial from '../../responseTypes/ApiProfilePartial';

function getProfilePartial(user?: User): ApiProfilePartial {
    return {
        userId: user?.id ?? 0,
        username: user?.dispName ?? 'HQTV Guest',
        admin: user?.admin ?? false,
        tester: user?.tester ?? false,
        booster: user?.booster ?? false,
        avatarUrl: user?.avatarUrl ?? defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)]
    }
}

export default getProfilePartial;
