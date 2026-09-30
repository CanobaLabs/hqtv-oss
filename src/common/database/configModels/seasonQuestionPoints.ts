import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class SeasonQuestionPoints extends Model {
    declare itemId: number;
    declare seasonAttributeId: string;
    declare questionNumber: number;
    declare points: number;
}

SeasonQuestionPoints.init({
    itemId: {
        type: DataTypes.STRING,
        primaryKey: true,
		autoIncrement: true
    },
    seasonAttributeId: {
        type: DataTypes.STRING,
		allowNull: false
    },
    questionNumber: {
        type: DataTypes.INTEGER
    },
    points: {
        type: DataTypes.INTEGER,
		allowNull: false
    }
}, {
    tableName: 'seasonQuestionPoints',
    sequelize: configDb,
    freezeTableName: true
});

export default SeasonQuestionPoints;
