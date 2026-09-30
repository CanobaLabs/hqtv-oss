import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class OffairAnswer extends Model {
    declare offairAnswerId: number;
    declare offairQuestionId: number;
    declare text: string;
    declare correct: boolean;
}

OffairAnswer.init({
    offairAnswerId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    offairQuestionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    text: {
        type: DataTypes.STRING,
        allowNull: false
    },
    correct: {
        type: DataTypes.TINYINT,
        allowNull: false
    }
}, {
    tableName: 'offairAnswer',
    sequelize: featureDb,
    freezeTableName: true
});

export default OffairAnswer;
