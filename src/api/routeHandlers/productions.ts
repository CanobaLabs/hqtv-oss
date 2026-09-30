import Audit from '../../common/database/adminModels/audit';
import Production from '../../common/database/eventModels/production';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import { ProductionStatus } from '../../common/enums';
import { Op } from 'sequelize';

export async function getProductionForGame(gameIdStr: string) {
	// Check cache
	const cached = await redis.get(rKey.apGameProduction(gameIdStr));
	if (cached) {
		const parsed = JSON.parse(cached);
		return parsed === null ? null : parsed;
	}
	
	const production = await Production.findOne({ where: { id: gameIdStr }, raw: true });
    if (!production) {
		// Cache null result as well (don't await - fire and forget to avoid blocking)
		redis.set(rKey.apGameProduction(gameIdStr), JSON.stringify(null)).catch(() => {});
		return null;
	}
	
	// Cache the result (no expiration - cache forever)
	// Don't await - fire and forget to avoid blocking the response
	redis.set(rKey.apGameProduction(gameIdStr), JSON.stringify(production)).catch(() => {});
	
    return production;
}

export async function getProductionForGamesBatch(gameIds: (string | number)[]): Promise<Record<string, any>> {
	if (!Array.isArray(gameIds) || gameIds.length === 0) {
		return {};
	}

	// Limit batch size to prevent abuse
	const MAX_BATCH_SIZE = 100;
	
	// Validate and sanitize game IDs - only allow numeric strings or numbers
	const limitedGameIds = gameIds
		.slice(0, MAX_BATCH_SIZE)
		.map(id => {
			// Convert to string and validate it's numeric
			const idStr = String(id);
			// Only allow numeric strings (integers)
			if (!/^\d+$/.test(idStr)) {
				return null;
			}
			return idStr;
		})
		.filter((id): id is string => id !== null);
	
	// If no valid IDs after filtering, return empty result
	if (limitedGameIds.length === 0) {
		return {};
	}

	// Check cache for all game IDs
	const cacheKeys = limitedGameIds.map(id => rKey.apGameProduction(id));
	const cachedResults = await redis.mGet(cacheKeys);
	
	const result: Record<string, any> = {};
	const uncachedIds: string[] = [];

	// Process cached results
	cachedResults.forEach((cached, index) => {
		const gameId = limitedGameIds[index];
		if (cached !== null) {
			try {
				const parsed = JSON.parse(cached);
				result[gameId] = parsed === null ? null : parsed;
			} catch {
				// If parsing fails, treat as uncached
				uncachedIds.push(gameId);
			}
		} else {
			uncachedIds.push(gameId);
		}
	});

	// Fetch uncached productions from database in a single query
	if (uncachedIds.length > 0) {
		const productions = await Production.findAll({
			where: { id: { [Op.in]: uncachedIds } },
			raw: true
		});

		// Create a map of fetched productions
		const productionMap = new Map(productions.map(p => [String(p.id), p]));

		// Process uncached IDs
		const cacheWrites: Array<[string, string]> = [];
		uncachedIds.forEach(gameId => {
			const production = productionMap.get(gameId);
			if (production) {
				result[gameId] = production;
				cacheWrites.push([rKey.apGameProduction(gameId), JSON.stringify(production)]);
			} else {
				result[gameId] = null;
				cacheWrites.push([rKey.apGameProduction(gameId), JSON.stringify(null)]);
			}
		});

		// Batch write to cache
		if (cacheWrites.length > 0) {
			const multi = redis.multi();
			cacheWrites.forEach(([key, value]) => {
				multi.set(key, value);
			});
			await multi.exec();
		}
	}

	return result;
}

export async function addEmployeesToProduction(productionIdStr: string, employeeId: string, body: { [k: string]: unknown; }) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    type CrewKey = 'writers' | 'producers' | 'hosts';
    let tentativeCrew: {writers: string[] | undefined, hosts: string[] | undefined, producers: string[] | undefined} = {writers: undefined, hosts: undefined, producers: undefined}
    if (gameProduction.writers != "") tentativeCrew.writers = gameProduction.writers.split(",");
    if (gameProduction.producers != "") tentativeCrew.producers = gameProduction.producers.split(",");
    if (gameProduction.hosts != "") tentativeCrew.hosts = gameProduction.hosts.split(",");
    let editedPositions: string[] = [];
    
    // Collect all employees to validate in batch
    const allEmployees: string[] = [];
    for (const [key, value] of Object.entries(body)) {
        if (!["writers","producers","hosts"].includes(key)) throw new HqError(`Invalid key: ${key}`, 0, 400);
        if (!Array.isArray(value)) throw new HqError(`${key} must be an array`, 0, 400);
        const employees = value as string[];
        allEmployees.push(...employees);
    }
    
    // Batch check all employees exist
    if (allEmployees.length > 0) {
        const employeeChecks = await Promise.all(
            allEmployees.map(emp => redis.exists(rKey.employee(emp)))
        );
        const invalidEmployees = allEmployees.filter((emp, idx) => !employeeChecks[idx]);
        if (invalidEmployees.length > 0) {
            throw new HqError(`Employees do not exist: ${invalidEmployees.join(', ')}`, 0, 400);
        }
    }
    
    // Check for duplicates within each role list
    for (const [key, value] of Object.entries(body)) {
        const employees = value as string[];
        const crewKey = key as CrewKey;
        
        // Check for duplicates within the incoming array itself
        const seenInRequest = new Set<string>();
        const duplicatesInRequest: string[] = [];
        for (const emp of employees) {
            if (seenInRequest.has(emp)) {
                duplicatesInRequest.push(emp);
            } else {
                seenInRequest.add(emp);
            }
        }
        if (duplicatesInRequest.length > 0) {
            throw new HqError(`Duplicate employees in ${key}: ${[...new Set(duplicatesInRequest)].join(', ')}`, 0, 400);
        }
        
        // Check if any incoming employee already exists in that role
        const existingCrew = tentativeCrew[crewKey] || [];
        const existingCrewSet = new Set(existingCrew);
        const alreadyExists = employees.filter(emp => existingCrewSet.has(emp));
        if (alreadyExists.length > 0) {
            throw new HqError(`Employees already in ${key}: ${alreadyExists.join(', ')}`, 0, 400);
        }
    }
    
    // Process employees after validation
    for (const [key, value] of Object.entries(body)) {
        const employees = value as string[];
        const crewKey = key as CrewKey;
        if (tentativeCrew[crewKey] === undefined) tentativeCrew[crewKey] = [];
        tentativeCrew[crewKey]!.push(...employees);
        if (!editedPositions.includes(key)) editedPositions.push(key);
        logger.debug('tentativeCrew', { key, crew: tentativeCrew[crewKey] });
    }
    
    // Batch create all audit entries
    const auditEntries = [];
    for (const [key, value] of Object.entries(body)) {
        const employees = value as string[];
        for (const employee of employees) {
            auditEntries.push({
                to: productionIdStr,
                toType: 'production' as const,
                subTo: employee,
                subToType: 'employee' as const,
                from: employeeId,
                fromType: 'employee' as const,
                action: 'add_assignment' as const,
                description: `Assigned ${employee} to ${key}`
            });
        }
    }
    
    // Parallelize Production update, Audit creates, and cache invalidation
    await Promise.all([
        Production.update({ 
            writers: tentativeCrew.writers === undefined ? undefined : tentativeCrew.writers.join(","), 
            producers: tentativeCrew.producers === undefined ? undefined : tentativeCrew.producers.join(","), 
            hosts: tentativeCrew.hosts === undefined ? undefined : tentativeCrew.hosts.join(",") 
        }, { where: { id: productionIdStr } }),
        ...auditEntries.map(entry => Audit.create(entry)),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}

export async function removeEmployeesFromProduction(productionIdStr: string, employeeId: string, body: { [k: string]: unknown; }) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    type CrewKey = 'writers' | 'producers' | 'hosts';
    let tentativeCrew: {writers: string[] | undefined, hosts: string[] | undefined, producers: string[] | undefined} = {writers: undefined, hosts: undefined, producers: undefined}
    if (gameProduction.writers != "") tentativeCrew.writers = gameProduction.writers.split(",");
    if (gameProduction.producers != "") tentativeCrew.producers = gameProduction.producers.split(",");
    if (gameProduction.hosts != "") tentativeCrew.hosts = gameProduction.hosts.split(",");
    
    // Collect all employees to validate in batch
    const allEmployees: string[] = [];
    for (const [key, value] of Object.entries(body)) {
        if (!["writers","producers","hosts"].includes(key)) throw new HqError(`Invalid key: ${key}`, 0, 400);
        if (!Array.isArray(value)) throw new HqError(`${key} must be an array`, 0, 400);
        const employees = value as string[];
        allEmployees.push(...employees);
    }
    
    // Batch check all employees exist
    if (allEmployees.length > 0) {
        const employeeChecks = await Promise.all(
            allEmployees.map(emp => redis.exists(rKey.employee(emp)))
        );
        const invalidEmployees = allEmployees.filter((emp, idx) => !employeeChecks[idx]);
        if (invalidEmployees.length > 0) {
            throw new HqError(`Employees do not exist: ${invalidEmployees.join(', ')}`, 0, 400);
        }
    }
    
    // Check for duplicates within each role list in the request
    for (const [key, value] of Object.entries(body)) {
        const employees = value as string[];
        
        // Check for duplicates within the incoming array itself
        const seenInRequest = new Set<string>();
        const duplicatesInRequest: string[] = [];
        for (const emp of employees) {
            if (seenInRequest.has(emp)) {
                duplicatesInRequest.push(emp);
            } else {
                seenInRequest.add(emp);
            }
        }
        if (duplicatesInRequest.length > 0) {
            throw new HqError(`Duplicate employees in ${key}: ${[...new Set(duplicatesInRequest)].join(', ')}`, 0, 400);
        }
    }
    
    // Process employees for removal
    const auditEntries = [];
    for (const [key, value] of Object.entries(body)) {
        const employees = value as string[];
        const crewKey = key as CrewKey;
        if (tentativeCrew[crewKey] === undefined) tentativeCrew[crewKey] = [];
        
        // Remove each employee from the crew list
        for (const employee of employees) {
            const employeeIndex = tentativeCrew[crewKey]!.indexOf(employee);
            if (employeeIndex > -1) {
                tentativeCrew[crewKey]!.splice(employeeIndex, 1);
                auditEntries.push({
                    to: productionIdStr,
                    toType: 'production' as const,
                    subTo: employee,
                    subToType: 'employee' as const,
                    from: employeeId,
                    fromType: 'employee' as const,
                    action: 'remove_assignment' as const,
                    description: `Unassigned ${employee} from ${key}`
                });
            }
        }
    }
    
    // Parallelize Production update, Audit creates, and cache invalidation
    await Promise.all([
        Production.update({ 
            writers: tentativeCrew.writers === undefined ? undefined : tentativeCrew.writers.join(","), 
            producers: tentativeCrew.producers === undefined ? undefined : tentativeCrew.producers.join(","), 
            hosts: tentativeCrew.hosts === undefined ? undefined : tentativeCrew.hosts.join(",") 
        }, { where: { id: productionIdStr } }),
        ...auditEntries.map(entry => Audit.create(entry)),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}

export async function removeEmployeeFromPosition(productionIdStr: string, employeeId: string, position: string, actioningEmployeeId: string) {
    // Legacy function - removes an employee either from the writers, producers, or hosts list (specified by position)
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    if (!["writers","producers","hosts"].includes(position)) throw new HqError(`Invalid position: ${position}`, 0, 400);
    type CrewKey = 'writers' | 'producers' | 'hosts';
    let tentativeCrew: {writers: string[] | undefined, hosts: string[] | undefined, producers: string[] | undefined} = {writers: undefined, hosts: undefined, producers: undefined}
    if (!employeeId) throw new HqError('Employee must be specified', 0, 400);
    if (gameProduction.writers != "") tentativeCrew.writers = gameProduction.writers.split(",");
    if (gameProduction.producers != "") tentativeCrew.producers = gameProduction.producers.split(",");
    if (gameProduction.hosts != "") tentativeCrew.hosts = gameProduction.hosts.split(",");
    if (!await redis.exists(rKey.employee(employeeId))) throw new HqError(`Employee does not exist: ${employeeId}`, 0, 400);
    
    const crewKey = position as CrewKey;
    if (tentativeCrew[crewKey] == undefined) tentativeCrew[crewKey] = [];
    const employeeIndex = tentativeCrew[crewKey]!.indexOf(employeeId);
    if (employeeIndex > -1) {
        tentativeCrew[crewKey]!.splice(employeeIndex, 1);
    }
    
    await Audit.create({
        to: productionIdStr,
        toType: 'production',
        subTo: employeeId,
        subToType: 'employee',
        from: actioningEmployeeId,
        fromType: 'employee',
        action: 'remove_assignment',
        description: `Unassigned ${employeeId} from ${position}`
    });
    await Promise.all([
        Production.update({ 
            writers: tentativeCrew.writers === undefined ? undefined : tentativeCrew.writers.join(","), 
            producers: tentativeCrew.producers === undefined ? undefined : tentativeCrew.producers.join(","), 
            hosts: tentativeCrew.hosts === undefined ? undefined : tentativeCrew.hosts.join(",") 
        }, { where: { id: productionIdStr }}),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    return {};
}

export async function updateQuestionsStatus(productionIdStr: string, status: string, actioningEmployeeId: string) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    if (!status || typeof status !== 'string' || status.trim() === '') {
        throw new HqError('Status must be a non-empty string', 0, 400);
    }
    
    // Validate status is one of the allowed enum values
    const allowedStatuses = Object.values(ProductionStatus);
    if (!allowedStatuses.includes(status as ProductionStatus)) {
        throw new HqError(`Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`, 0, 400);
    }
    
    const previousStatus = gameProduction.questions_status;
    
    await Promise.all([
        Production.update({ questions_status: status }, { where: { id: productionIdStr } }),
        Audit.create({
            to: productionIdStr,
            toType: 'production',
            from: actioningEmployeeId,
            fromType: 'employee',
            action: 'update_questions_status',
            description: `Changed questions_status from "${previousStatus}" to "${status}"`
        }),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}

export async function updateScriptStatus(productionIdStr: string, status: string, actioningEmployeeId: string) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    if (!status || typeof status !== 'string' || status.trim() === '') {
        throw new HqError('Status must be a non-empty string', 0, 400);
    }
    
    // Validate status is one of the allowed enum values
    const allowedStatuses = Object.values(ProductionStatus);
    if (!allowedStatuses.includes(status as ProductionStatus)) {
        throw new HqError(`Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`, 0, 400);
    }
    
    const previousStatus = gameProduction.script_status;
    
    await Promise.all([
        Production.update({ script_status: status }, { where: { id: productionIdStr } }),
        Audit.create({
            to: productionIdStr,
            toType: 'production',
            from: actioningEmployeeId,
            fromType: 'employee',
            action: 'update_script_status',
            description: `Changed script_status from "${previousStatus}" to "${status}"`
        }),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}

export async function updateGameStatus(productionIdStr: string, status: string, actioningEmployeeId: string) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    if (!status || typeof status !== 'string' || status.trim() === '') {
        throw new HqError('Status must be a non-empty string', 0, 400);
    }
    
    // Validate status is either "aired" or "unaired"
    const allowedStatuses = ['aired', 'unaired'];
    if (!allowedStatuses.includes(status)) {
        throw new HqError(`Invalid game_status. Allowed values are: ${allowedStatuses.join(', ')}`, 0, 400);
    }
    
    const previousStatus = gameProduction.game_status;
    
    await Promise.all([
        Production.update({ game_status: status }, { where: { id: productionIdStr } }),
        Audit.create({
            to: productionIdStr,
            toType: 'production',
            from: actioningEmployeeId,
            fromType: 'employee',
            action: 'update_game_status',
            description: `Changed game_status from "${previousStatus}" to "${status}"`
        }),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}

export async function updateProductionFields(productionIdStr: string, body: { date_at?: string | null; cancelled?: boolean | number; youtube?: string | null; }, actioningEmployeeId: string) {
    const gameProduction = await Production.findOne({ where: { id: productionIdStr } });
    if (!gameProduction) throw new HqError('No production info found for this game.', 0, 500);
    
    const updateData: { date_at?: Date | null; cancelled?: number; youtube?: string | null } = {};
    const auditDescriptions: string[] = [];
    
    if (body.date_at !== undefined) {
        let dateValue: Date | null = null;
        if (body.date_at !== null && body.date_at !== '') {
            dateValue = new Date(body.date_at);
            if (isNaN(dateValue.getTime())) {
                throw new HqError('Invalid date format for date_at', 0, 400);
            }
        }
        const previousDate = gameProduction.date_at;
        updateData.date_at = dateValue;
        auditDescriptions.push(`Changed date_at from "${previousDate ? previousDate.toISOString() : 'null'}" to "${dateValue ? dateValue.toISOString() : 'null'}"`);
    }
    
    if (body.cancelled !== undefined) {
        const cancelledValue = body.cancelled === true || body.cancelled === 1 ? 1 : 0;
        const previousCancelled = gameProduction.cancelled;
        updateData.cancelled = cancelledValue;
        auditDescriptions.push(`Changed cancelled from "${previousCancelled}" to "${cancelledValue}"`);
    }
    
    if (body.youtube !== undefined) {
        let youtubeValue: string | null = null;
        if (body.youtube !== null && body.youtube !== '') {
            const youtubeStr = String(body.youtube).trim();
            // Basic validation: check if it looks like a YouTube URL
            // Accepts youtube.com, youtu.be, and youtube-nocookie.com URLs
            const youtubeUrlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/i;
            if (!youtubeUrlPattern.test(youtubeStr)) {
                throw new HqError('Invalid YouTube URL format', 0, 400);
            }
            youtubeValue = youtubeStr;
        }
        const previousYoutube = gameProduction.youtube;
        updateData.youtube = youtubeValue;
        auditDescriptions.push(`Changed youtube from "${previousYoutube || 'null'}" to "${youtubeValue || 'null'}"`);
    }
    
    if (Object.keys(updateData).length === 0) {
        throw new HqError('No valid fields to update', 0, 400);
    }
    
    await Promise.all([
        Production.update(updateData, { where: { id: productionIdStr } }),
        Audit.create({
            to: productionIdStr,
            toType: 'production',
            from: actioningEmployeeId,
            fromType: 'employee',
            action: 'update_production_fields',
            description: auditDescriptions.join('; ')
        }),
        redis.del(rKey.apGameProduction(productionIdStr))
    ]);
    
    return {};
}
