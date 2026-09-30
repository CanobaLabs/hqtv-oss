import { NextFunction, Request, Response } from 'express';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import catchErrors from './catchErrors';
import { getProductionForGame } from '../routeHandlers/productions';
import { calculateEmployeePermissionSets } from '../routeHandlers/employees';

export const restrictToAdmin = catchErrors((req: Request, res: Response, next: NextFunction) => {
    if (req?.cfAuth) return next() // User has been authenticated as an employee
    if (req.authUser.admin) {
        return next();
    } else {
        logger.info(`Insufficient permissions. UID=${req.authUser?.id}, Endpoint=${req.url}`);
        throw new HqError('not authorized', 102, 403);
    }
});

export const restrictToSelfOrAdmin = catchErrors((req: Request, res: Response, next: NextFunction) => {
    if (req.reqUser.id === req.authUser.id) {
        // managing self
        next();
    } else {
        // managing another user; only admins can do this
        restrictToAdmin(req, res, next);
    }
});

export const restrictToTesterOrAdmin = catchErrors((req: Request, res: Response, next: NextFunction) => {
    if (req.authUser?.tester || req.authUser?.admin) {
        return next();
    } else {
        return restrictToAdmin(req, res, next);
    }
});

export const restrictToGameHostOrProducer = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cfAuth) {
        return next();
    }
    
    const gameId = req.params.gameId || req.params.id;
    if (!gameId) {
        throw new HqError('Game ID is required', 0, 400);
    }
    
    // Check if user has produce permission (override)
    const permissions = await calculateEmployeePermissionSets(req.cfAuth.userId);
    const hasProducePermission = permissions.combined.includes('game.produce');
    
    if (hasProducePermission) {
        return next();
    }
    
    // If no permission override, check if user is host or producer of the game
    const production = await getProductionForGame(gameId);
    if (!production) {
        throw new HqError('Production not found for this game.', 0, 404);
    }
    
    const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
    const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
    const employeeDiscordId = req.cfAuth.userId;
    
    if (!hosts.includes(employeeDiscordId) && !producers.includes(employeeDiscordId)) {
        logger.info(`Insufficient permissions. Employee=${employeeDiscordId}, GameId=${gameId}, Endpoint=${req.url}`);
        throw new HqError('Must be a host or producer of this game, or have produce permission.', 102, 403);
    }
    
    return next();
});

export const restrictToGameEditorOrPermission = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cfAuth) {
        throw new HqError('Unauthorized', 101, 401);
    }
    
    const gameId = req.params.id;
    if (!gameId) {
        throw new HqError('Game ID is required', 0, 400);
    }
    
    // Check if user has game.edit permission (override)
    const permissions = await calculateEmployeePermissionSets(req.cfAuth.userId);
    const hasGameEditPermission = permissions.combined.includes('game.edit');
    
    if (hasGameEditPermission) {
        return next();
    }
    
    // If no permission override, check if user is host/writer/producer of the game
    const production = await getProductionForGame(gameId);
    if (!production) {
        throw new HqError('Production not found for this game.', 0, 404);
    }
    
    const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
    const writers = production.writers ? production.writers.split(',').map((id: string) => id.trim()) : [];
    const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
    const employeeDiscordId = req.cfAuth.userId;
    
    const isGameMember = hosts.includes(employeeDiscordId) || writers.includes(employeeDiscordId) || producers.includes(employeeDiscordId);
    
    if (!isGameMember) {
        logger.info(`Insufficient permissions. Employee=${employeeDiscordId}, GameId=${gameId}, Endpoint=${req.url}`);
        throw new HqError('Must be a host, writer, or producer of this game, or have game.edit permission.', 102, 403);
    }
    
    return next();
});

export const restrictToGameScheduleEditorOrPermission = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cfAuth) {
        throw new HqError('Unauthorized', 101, 401);
    }
    
    const gameId = req.params.id;
    if (!gameId) {
        throw new HqError('Game ID is required', 0, 400);
    }
    
    // Check if user has schedule.edit permission (override)
    const permissions = await calculateEmployeePermissionSets(req.cfAuth.userId);
    const hasScheduleEditPermission = permissions.combined.includes('schedule.edit');
    
    if (hasScheduleEditPermission) {
        return next();
    }
    
    // If no permission override, check if user is host or producer of the game
    const production = await getProductionForGame(gameId);
    if (!production) {
        throw new HqError('Production not found for this game.', 0, 404);
    }
    
    const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
    const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
    const employeeDiscordId = req.cfAuth.userId;
    
    const isGameHostOrProducer = hosts.includes(employeeDiscordId) || producers.includes(employeeDiscordId);
    
    if (!isGameHostOrProducer) {
        logger.info(`Insufficient permissions. Employee=${employeeDiscordId}, GameId=${gameId}, Endpoint=${req.url}`);
        throw new HqError('Must be a host or producer of this game, or have schedule.edit permission.', 102, 403);
    }
    
    return next();
});

export const restrictToGameHostOrProducerOrEditPermission = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cfAuth) {
        throw new HqError('Unauthorized', 101, 401);
    }
    
    const gameId = req.params.id;
    if (!gameId) {
        throw new HqError('Game ID is required', 0, 400);
    }
    
    // Check if user has game.edit permission (override)
    const permissions = await calculateEmployeePermissionSets(req.cfAuth.userId);
    const hasGameEditPermission = permissions.combined.includes('game.edit');
    
    if (hasGameEditPermission) {
        return next();
    }
    
    // If no permission override, check if user is host or producer of the game
    const production = await getProductionForGame(gameId);
    if (!production) {
        throw new HqError('Production not found for this game.', 0, 404);
    }
    
    const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
    const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
    const employeeDiscordId = req.cfAuth.userId;
    
    const isGameHostOrProducer = hosts.includes(employeeDiscordId) || producers.includes(employeeDiscordId);
    
    if (!isGameHostOrProducer) {
        logger.info(`Insufficient permissions. Employee=${employeeDiscordId}, GameId=${gameId}, Endpoint=${req.url}`);
        throw new HqError('Must be a host or producer of this game, or have game.edit permission.', 102, 403);
    }
    
    return next();
});
