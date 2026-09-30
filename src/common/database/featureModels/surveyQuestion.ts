import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class SurveyQuestion extends Model {
    declare surveyQuestionId: number;
    declare gameId: number | null;
    declare question: string;
    declare questionDurationMs: number;
    declare resultsDurationMs: number;
}

SurveyQuestion.init({
    surveyQuestionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    gameId: {
        type: DataTypes.INTEGER
    },
    question: {
        type: DataTypes.STRING,
        allowNull: false
    },
    questionDurationMs: {
        type: DataTypes.INTEGER
    },
    resultsDurationMs: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'surveyQuestion',
    sequelize: featureDb,
    freezeTableName: true
});

export default SurveyQuestion;
