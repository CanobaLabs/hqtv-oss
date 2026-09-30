import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class GiftDrop extends Model {
    declare giftDropId: number;
    declare created: Date;
    declare creatorId: number;
    declare createdLive: boolean;
}

GiftDrop.init({
    giftDropId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    created: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    creatorId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    createdLive: {
        type: DataTypes.TINYINT,
        allowNull: false
    }
}, {
    tableName: 'giftDrop',
    sequelize: featureDb,
    freezeTableName: true
});

export default GiftDrop;
