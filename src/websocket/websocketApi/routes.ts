import { Express } from 'express';
import authorise from '../../api/middleware/authorise';
import HqError from '../../common/hqError';
import runGameCommand from '../gameMasterHandlers/runGameCommand';
import getBroadcastId from './getBroadcastIdMiddleware';
import startGame from './startGame';
import cfAuth from '../../api/middleware/cfAuth';
import { restrictToAdmin, restrictToGameHostOrProducer } from '../../api/middleware/restrictToPrivilege';
import catchErrors from '../../api/middleware/catchErrors';

export default function(api: Express) {
    api.post('/games/:gameId(\\d+)/startGame', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, catchErrors(async (req, res, next) => {
        const result = await startGame(req.params.gameId, req.body);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/question', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('question', req.broadcastId, req.body);
        return res.json(result);
    }));
  
    api.post('/games/:gameId(\\d+)/surveyQuestion', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('surveyQuestion', req.broadcastId, req.body);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/surveyResults', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        // this event should automatically run on timer but this serves as a backup
        const result = await runGameCommand('surveyResults', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/checkpoint', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('checkpoint', req.broadcastId, req.query?.force ?? "false");
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/checkpointSummary', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        // this event should automatically run on timer but this serves as a backup
        const result = await runGameCommand('checkpointSummary', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/giftDrop', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('giftDrop', req.broadcastId, req.body);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/chatAnnounce', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('chatAnnounce', req.broadcastId, req.body.message);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/results', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('questionResults', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/winners', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('winners', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/close', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('close', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/nextLogical', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('nextLogical', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/revealLetter', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('revealLetter', req.broadcastId, req.body?.letter ?? null);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/wheel', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('wheel', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/revive/:playerGroup', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('revivePlayers', req.broadcastId, req.params.playerGroup);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/kick/:userId(\\d+)', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('kick', req.broadcastId, [req.params.userId]);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/eliminate/:userId(\\d+)', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('eliminate', req.broadcastId, [req.params.userId]);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/disableChat', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('disableChat', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/dynamicPotAnimation', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('dynamicPotAnimation', req.broadcastId);
        return res.json(result);
    }));

    api.post('/games/:gameId(\\d+)/custom', authorise(), restrictToAdmin, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('custom', req.broadcastId, req.body);
        return res.json(result);
    }));
    
    api.post('/games/:gameId(\\d+)/callout', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('callout', req.broadcastId, req.body);
        return res.json(result);
    }));
    
    api.post('/games/:gameId(\\d+)/endGame', cfAuth(), authorise(), restrictToAdmin, restrictToGameHostOrProducer, getBroadcastId, catchErrors(async (req, res, next) => {
        const result = await runGameCommand('endGame', req.broadcastId);
        return res.json(result);
    }));
    
    api.get('/heartbeat', catchErrors(async (req, res, next) => {
        return res.send("1")
    }));

    api.all('*', catchErrors((req, res, next) => {
        throw new HqError('not found', 434, 404);
    }));
}
