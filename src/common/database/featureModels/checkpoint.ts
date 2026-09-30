import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class Checkpoint extends Model {
    declare checkpointId: number;
    declare gameId: number;
    declare questionNumber: number;
    declare totalPrizeCents: number;
}

Checkpoint.init({
    checkpointId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    questionNumber: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    totalPrizeCents: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'checkpoint',
    sequelize: featureDb,
    freezeTableName: true
});

export default Checkpoint;
