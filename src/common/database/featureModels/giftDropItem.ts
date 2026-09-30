import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class GiftDropItem extends Model {
    declare itemId: number;
    declare giftDropId: number;
    declare itemType: string;
    declare itemQuantity: number;
    declare itemChance: number;
}

GiftDropItem.init({
    itemId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    giftDropId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    itemType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    itemQuantity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    itemChance: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'giftDropItem',
    sequelize: featureDb,
    freezeTableName: true
});

export default GiftDropItem;
