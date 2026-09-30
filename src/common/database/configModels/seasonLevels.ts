import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class SeasonLevel extends Model {
    declare itemId: number;
    declare seasonAttributeId: string;
    declare levelNumber: number;
    declare minPoints: number;
    declare maxPoints: number;
    declare description: string;
    declare textColor: string;
	declare accentColor: string;
	declare textAccentColor: string;
	declare cardBgImage: string;
	declare bgColor: string;
	declare bgImage: string;
}

SeasonLevel.init({
    itemId: {
        type: DataTypes.STRING,
        primaryKey: true,
		autoIncrement: true
    },
    seasonAttributeId: {
        type: DataTypes.STRING,
		allowNull: false
    },
    levelNumber: {
        type: DataTypes.INTEGER,
		allowNull: false
    },
    minPoints: {
        type: DataTypes.INTEGER,
		allowNull: false
    },
    maxPoints: {
        type: DataTypes.INTEGER,
		allowNull: false
    },
    description: {
        type: DataTypes.STRING,
		allowNull: false
    },
    textColor: {
        type: DataTypes.STRING,
		allowNull: false
    },
	accentColor: {
        type: DataTypes.STRING,
		allowNull: false
    },
	textAccentColor: {
        type: DataTypes.STRING,
		allowNull: false
    },
	cardBgImage: {
        type: DataTypes.STRING,
		allowNull: false
    },
	bgColor: {
        type: DataTypes.STRING,
		allowNull: false
    },
	bgImage: {
        type: DataTypes.STRING,
		allowNull: false
    }
}, {
    tableName: 'seasonLevel',
    sequelize: configDb,
    freezeTableName: true
});

export default SeasonLevel;
