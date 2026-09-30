import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class CompletedOffairGame extends Model {
    declare gameUuid: string;
    declare userId: number;
    declare started: Date;
    declare finished: Date;
    declare pointsEarned: number;
    declare coinsEarned: number;
    declare questionCount: number;
    declare questionsCorrect: number;
    declare questionsIncorrect: number;
}

CompletedOffairGame.init({
    gameUuid: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    started: {
        type: DataTypes.DATE,
        allowNull: false
    },
    finished: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    pointsEarned: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    coinsEarned: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    questionCount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    questionsCorrect: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    questionsIncorrect: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'completedOffairGame',
    sequelize: userDb,
    freezeTableName: true
});

export default CompletedOffairGame;
