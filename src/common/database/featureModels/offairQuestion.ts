import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class OffairQuestion extends Model {
    declare offairQuestionId: number;
    declare question: string;
    declare totalTimeMs: number;
}

OffairQuestion.init({
    offairQuestionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    question: {
        type: DataTypes.STRING,
        allowNull: false
    },
    totalTimeMs: {
        type: DataTypes.INTEGER,
        defaultValue: 10000,
        allowNull: false
    }
}, {
    tableName: 'offairQuestion',
    sequelize: featureDb,
    freezeTableName: true
});

export default OffairQuestion;
