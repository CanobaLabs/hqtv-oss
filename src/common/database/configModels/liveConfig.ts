import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class LiveConfig extends Model {
    declare id: number;
    declare envName: string;
    declare rehearsal: number;
    declare socketUrl: string;
    declare source: string;
    declare passthrough: string;
    declare high: string;
    declare medium: string;
    declare low: string;
    declare playlistUrl: string;
}

LiveConfig.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    envName: {
        type: DataTypes.STRING
    },
    rehearsal: {
        type: DataTypes.TINYINT
    },
    socketUrl: {
        type: DataTypes.STRING
    },
    source: {
        type: DataTypes.STRING
    },
    passthrough: {
        type: DataTypes.STRING
    },
    high: {
        type: DataTypes.STRING
    },
    medium: {
        type: DataTypes.STRING
    },
    low: {
        type: DataTypes.STRING
    },
    playlistUrl: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'liveConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default LiveConfig;
