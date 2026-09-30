import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class ItemHistory extends Model {
    declare id: number;
    declare date: string;
    declare userId: number;
    declare item: string;
    declare qty: number;
    declare reason: string | null;
    declare broadcastId: number | null;
    declare seasonId: string | null;
    declare counted: number;
}

ItemHistory.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    item: {
        type: DataTypes.STRING,
        allowNull: false
    },
    qty: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING
    },
    broadcastId: {
        type: DataTypes.INTEGER
    },
    seasonId: {
        type: DataTypes.STRING
    },
    counted: {
        type: DataTypes.TINYINT,
        allowNull: false
    }
}, {
    tableName: 'itemHistory',
    sequelize: userDb,
    freezeTableName: true
});

export default ItemHistory;
