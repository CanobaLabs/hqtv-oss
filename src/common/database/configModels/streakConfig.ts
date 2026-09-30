import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class StreakConfig extends Model {
    declare versionId: number;
    declare streaksEnabled: number;
    declare streakTarget: number;
    declare streakWaitSec: number;
    declare absenseEndsStreak: number;
    declare streakExpirySec: number | null;
}

StreakConfig.init({
    versionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    streaksEnabled: {
        type: DataTypes.TINYINT
    },
    streakTarget: {
        type: DataTypes.INTEGER
    },
    streakWaitSec: {
        type: DataTypes.INTEGER
    },
    absenseEndsStreak: {
        type: DataTypes.INTEGER
    },
    streakExpirySec: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'streakConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default StreakConfig;
