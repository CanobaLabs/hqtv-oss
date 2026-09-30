import { DataTypes, Model } from 'sequelize';
import { featureDb } from '../connections';

class SuperWheelItem extends Model {
    declare name: string;
    declare letters: string;
    declare lives: number;
}

SuperWheelItem.init({
    name: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    letters: {
        type: DataTypes.STRING,
        allowNull: false
    },
    lives: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'superWheelItem',
    sequelize: featureDb,
    freezeTableName: true
});

export default SuperWheelItem;
