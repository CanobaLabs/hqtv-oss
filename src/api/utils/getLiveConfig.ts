import LiveConfig from '../../common/database/configModels/liveConfig';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import { Op, literal } from 'sequelize';

type LiveConfigInstance = {
    socketUrl: string;
    source: string;
    passthrough: string;
    high: string;
    medium: string;
    low: string;
    playlistUrl: string;
}

async function getLiveConfig(rehearsal: boolean): Promise<LiveConfigInstance> {
    const envName = process.env.HQTV_ENV ?? process.env.ENVIRONMENT ?? 'prod';
    const rehearsalValue = rehearsal ? 1 : 0;
    
    // Check what records exist in the database
    const allConfigs = await LiveConfig.findAll();
    const availableConfigs = allConfigs.map(c => ({ 
        id: c.id, 
        envName: c.envName, 
        rehearsal: c.rehearsal 
    }));
    
    logger.info(`live config query: envName="${envName}", rehearsal=${rehearsal} (${rehearsalValue}), available configs: ${JSON.stringify(availableConfigs)}`);
    
    // Use case-insensitive comparison for envName
    const liveConfig = await LiveConfig.findOne({ 
        where: { 
            [Op.and]: [
                literal(`LOWER(envName) = LOWER('${envName.replace(/'/g, "''")}')`),
                { rehearsal: rehearsalValue }
            ]
        } 
    });
    
    if (!liveConfig) {
        logger.error(`live config not found: envName="${envName}", rehearsal=${rehearsal} (${rehearsalValue}), available configs: ${JSON.stringify(availableConfigs)}`);
        throw new HqError('live config missing', 0, 500);
    }
    
    return {
        socketUrl: liveConfig.socketUrl,
        source: liveConfig.source,
        passthrough: liveConfig.passthrough,
        high: liveConfig.high,
        medium: liveConfig.medium,
        low: liveConfig.low,
        playlistUrl: liveConfig.playlistUrl
    }
}

export async function getLiveConfigById(liveConfigId: number): Promise<LiveConfigInstance> {
    const liveConfig = await LiveConfig.findByPk(liveConfigId);
    if (!liveConfig) {
        throw new HqError('live config not found', 0, 404);
    }
    return {
        socketUrl: liveConfig.socketUrl,
        source: liveConfig.source,
        passthrough: liveConfig.passthrough,
        high: liveConfig.high,
        medium: liveConfig.medium,
        low: liveConfig.low,
        playlistUrl: liveConfig.playlistUrl
    }
}

export default getLiveConfig;
