import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class SeasonConfig extends Model {
    declare seasonId: string;
    declare seasonAttributeId: string;
    declare seasonName: string;
    declare enabled: number;
    declare startDate: Date;
    declare endDate: Date;
    declare tentpoleEnabled: number;
    declare tentpoleEnabled_android?: string;
    declare finalePrizeCents: number;
	declare howItWorks: string;
	declare disclaimer: string;
}

SeasonConfig.init({
    seasonId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    seasonAttributeId: {
        type: DataTypes.STRING,
		allowNull: false
    },
    seasonName: {
        type: DataTypes.STRING,
		allowNull: false
    },
    enabled: {
        type: DataTypes.TINYINT,
		allowNull: false
    },
    startDate: {
        type: DataTypes.DATE,
		allowNull: false
    },
    endDate: {
        type: DataTypes.DATE,
		allowNull: false
    },
    tentpoleEnabled: {
        type: DataTypes.TINYINT,
		allowNull: false
    },
    tentpoleEnabled_android: {
        type: DataTypes.STRING,
		allowNull: true
    },
    finalePrizeCents: {
        type: DataTypes.INTEGER,
		allowNull: false
    },
	howItWorks: {
        type: DataTypes.STRING,
		allowNull: false
    },
	disclaimer: {
        type: DataTypes.STRING,
		allowNull: false
    }
}, {
    tableName: 'seasonConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default SeasonConfig;
