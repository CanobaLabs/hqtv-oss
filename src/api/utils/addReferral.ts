import Referral from '../../common/database/userModels/referral';
import logger from '../../common/logger';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import { userDb } from '../../common/database/connections';

async function addReferral(adderId: number, referralUserId: number) {
    // grant both users a life
    userDb.transaction(async transaction => {
        await Promise.all([
            Referral.create({ newUserId: adderId, referralUserId }, { transaction }),
            adjustItemBalance([adderId], { lives: 1 }, { reason: 'referral' }, transaction),
            adjustItemBalance([referralUserId], { coins: 1000 }, { reason: 'referral' }, transaction)
        ]);
    });
    logger.info(`New user referral. ReferrerID=${adderId}, ReferringID=${referralUserId}`);
}

export default addReferral;
