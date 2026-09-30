import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class Opt extends Model {
    declare opt: string;
    declare title: string;
    declare description: string;
}

Opt.init({
    opt: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    title: {
        type: DataTypes.STRING
    },
    description: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'opt',
    sequelize: configDb,
    freezeTableName: true
});

export default Opt;
