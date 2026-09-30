import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class OffairTriviaConfig extends Model {
    declare versionId: number;
    declare enabled: number;
    declare questionCount: number;
    declare correctCoins: number;
    declare correctPoints: number;
    declare completionCoins: number;
    declare nextGameWaitSec: number;
    declare nextGameWaitSecBooster: number;
}

OffairTriviaConfig.init({
    versionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    enabled: {
        type: DataTypes.TINYINT
    },
    questionCount: {
        type: DataTypes.INTEGER
    },
    correctCoins: {
        type: DataTypes.INTEGER
    },
    correctPoints: {
        type: DataTypes.INTEGER
    },
    completionCoins: {
        type: DataTypes.INTEGER
    },
    nextGameWaitSec: {
        type: DataTypes.INTEGER
    },
    nextGameWaitSecBooster: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'offairTriviaConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default OffairTriviaConfig;
