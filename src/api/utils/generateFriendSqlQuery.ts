import { Op } from 'sequelize';

function generateFriendSqlQuery(userIds: [number, number]) {
    // wide query (retrieves both friendship records)
    return {
        [Op.or]: [
            { senderId: userIds[0], targetId: userIds[1] },
            { targetId: userIds[0], senderId: userIds[1] }
        ]
    }
}

export default generateFriendSqlQuery;
