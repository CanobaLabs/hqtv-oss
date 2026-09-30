import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class SurveyAnswer extends Model {
    declare surveyAnswerId: number;
    declare surveyQuestionId: number;
    declare text: string;
}

SurveyAnswer.init({
    surveyAnswerId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    surveyQuestionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    text: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'surveyAnswer',
    sequelize: featureDb,
    freezeTableName: true
});

export default SurveyAnswer;
