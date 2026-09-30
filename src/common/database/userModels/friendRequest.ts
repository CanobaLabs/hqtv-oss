import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class FriendRequest extends Model {
    declare friendRequestId: number;
    declare createDate: Date;
    declare senderId: number;
    declare targetId: number;
    declare accepted: number;
}

FriendRequest.init({
    friendRequestId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    createDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    senderId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    targetId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    accepted: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    }
}, {
    tableName: 'friendRequest',
    sequelize: userDb,
    freezeTableName: true
});

export default FriendRequest;
