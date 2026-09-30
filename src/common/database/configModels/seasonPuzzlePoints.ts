import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class SeasonPuzzlePoints extends Model {
    declare itemId: number;
    declare seasonAttributeId: string;
    declare puzzleNumber: number;
    declare points: number;
}

SeasonPuzzlePoints.init({
    itemId: {
        type: DataTypes.STRING,
        primaryKey: true,
		autoIncrement: true
    },
    seasonAttributeId: {
        type: DataTypes.STRING,
		allowNull: false
    },
    puzzleNumber: {
        type: DataTypes.INTEGER
    },
    points: {
        type: DataTypes.INTEGER,
		allowNull: false
    }
}, {
    tableName: 'seasonPuzzlePoints',
    sequelize: configDb,
    freezeTableName: true
});

export default SeasonPuzzlePoints;
