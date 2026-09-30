import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class GiftDropClaim extends Model {
    declare giftDropClaimId: number;
    declare giftDropId: number;
    declare userId: number;
    declare claimDate: Date;
    declare itemType: string;
    declare itemQuantity: string;
}

GiftDropClaim.init({
    giftDropClaimId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    giftDropId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    showId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    claimDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    itemType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    itemQuantity: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'giftDropClaim',
    sequelize: userDb,
    freezeTableName: true
});

export default GiftDropClaim;
