import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class Broadcast extends Model {
    declare broadcastId: number;
    declare gameId: number;
    declare rehearsal: number;
    declare forReal: number;
    declare started: Date;
    declare ended: Date;
}

Broadcast.init({
    broadcastId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    rehearsal: {
        type: DataTypes.TINYINT,
        allowNull: false
    },
    forReal: {
        type: DataTypes.TINYINT,
        allowNull: false
    },
    started: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    ended: {
        type: DataTypes.DATE
    }
}, {
    tableName: 'broadcast',
    sequelize: eventDb,
    freezeTableName: true
});

export default Broadcast;
