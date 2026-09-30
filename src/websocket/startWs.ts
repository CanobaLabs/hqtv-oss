import onUpgrade from './onUpgrade';
import startWsApi from './wsApi';
import { initializeUserEventListener } from './helpers/userEventPubSub';
import { startInactiveSocketMonitoring } from './helpers/monitorInactiveSocket';

const { server } = startWsApi();
onUpgrade(server) // accept connections

// Initialize user event listener for cross-server ban notifications
initializeUserEventListener();

// Start monitoring for inactive socket (auto-destroy after 15 minutes of no live games)
startInactiveSocketMonitoring();
