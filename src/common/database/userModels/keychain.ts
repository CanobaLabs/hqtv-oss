import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class Keychain extends Model {
    declare phone: string;
    declare userId: number;
    declare pinHash: string;
}

Keychain.init({
    phone: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    userId: {
        type: DataTypes.INTEGER,
        unique: true
    },
    pinHash: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'keychain',
    sequelize: userDb,
    freezeTableName: true
});

export default Keychain;
