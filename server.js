process.chdir(__dirname);

require('dotenv').config();

const PORT = process.env.PORT || 8080;

const azureStorage = require('azure-storage');
const bodyParser = require('body-parser');
const connect_ensure_login = require('connect-ensure-login');
const cookieParser = require('cookie-parser');
const express = require('express');
const expressSession = require('express-session');
const passport = require('passport');
const passportGithub = require('passport-github');
const path = require('path');
const NodeCache = require('node-cache');
const model = require('./src/model');

const blobServiceConnectionString = process.env.BLOB_SERVICE_CONNECTION_STRING;
const blobService = azureStorage.createBlobService(blobServiceConnectionString);

const tableServiceConnectionString = process.env.TABLE_SERVICE_CONNECTION_STRING;
const tableService = azureStorage.createTableService(tableServiceConnectionString);

const queueServiceConnectionString = process.env.QUEUE_SERVICE_CONNECTION_STRING;
const queueService = azureStorage.createQueueService(queueServiceConnectionString);

const accessRightsCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });
const accessRightsService = new model.AccessRightsService(tableService, accessRightsCache);

passport.use(new passportGithub.Strategy(
  {
    clientID: process.env.GITHUB_CLIENT,
    clientSecret: process.env.GITHUB_SECRET,
    callbackURL: `${process.env.VOTT_HOSTNAME}/auth/github/callback`
  },
  (accessToken, refreshToken, profile, cb) => {
    return cb(null, profile);
  }
));
passport.serializeUser((user, done) => {
  accessRightsService.upsertUser(user).then(result => {
    done(null, JSON.stringify(user));
  }).catch(error => {
    done(null, JSON.stringify(user));
  });
});
passport.deserializeUser((user, done) => {
  done(null, JSON.parse(user));
});

const app = express();
app.use(cookieParser());
app.use(expressSession({ secret: 'keyboard cat', resave: true, saveUninitialized: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());

app.get('/login', passport.authenticate('github'));
app.get(
  '/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/welcome.html');
  }
);

const router = new express.Router();
const api = require('./src/api');
const middleware = require('./src/middleware');

const accessRightsMiddleware = new middleware.AccessRightsMiddleware(accessRightsService);
const managerAccess = new middleware.ProjectManagerAccessPolicy();
const collaboratorAccess = new middleware.ProjectCollaboratorAccessPolicy();

const projectService = new model.ProjectService(blobService, tableService, queueService, accessRightsService);
const projectController = new api.ProjectController(projectService);
router.get('/projects', (req, res) => { projectController.list(req, res); });
router.post('/projects', accessRightsMiddleware, managerAccess, (req, res) => { projectController.create(req, res); });
router.get('/projects/:projectId', accessRightsMiddleware, collaboratorAccess, (req, res) => { projectController.read(req, res); });
router.put('/projects/:projectId', accessRightsMiddleware, managerAccess, (req, res) => { projectController.update(req, res); });
router.delete('/projects/:projectId', accessRightsMiddleware, managerAccess, (req, res) => { projectController.delete(req, res); });
router.get('/projects/:projectId/images/:imageId', accessRightsMiddleware, collaboratorAccess, (req, res) => { projectController.image(req, res); });
router.post('/projects/:projectId/instructionsImage', accessRightsMiddleware, managerAccess, (req, res) => { projectController.allocateInstructionsImage(req, res); });
router.put('/projects/:projectId/instructionsImage', accessRightsMiddleware, managerAccess, (req, res) => { projectController.commitInstructionsImage(req, res); });

const trainingImageService = new model.TrainingImageService(blobService, tableService, queueService, projectService);
const trainingImageController = new api.TrainingImageController(trainingImageService);
router.get('/projects/:projectId/trainingImages', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingImageController.list(req, res, next); });
router.get('/projects/:projectId/trainingImages/stats', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingImageController.stats(req, res, next); });
router.post('/projects/:projectId/trainingImages', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingImageController.allocate(req, res, next); });
router.put('/projects/:projectId/trainingImages/:imageId', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingImageController.create(req, res, next); });

router.get('/projects/:projectId/tasks/next', accessRightsMiddleware, collaboratorAccess, (req, res) => { trainingImageController.pullTask(req, res); });
router.post('/projects/:projectId/tasks/results', accessRightsMiddleware, collaboratorAccess, (req, res) => { trainingImageController.pushTask(req, res); });

const accessRightsController = new api.AccessRightsController(accessRightsService);
router.get('/projects/:projectId/accessRights', accessRightsMiddleware, managerAccess, (req, res, next) => { accessRightsController.list(req, res, next); });
router.post('/projects/:projectId/accessRights', accessRightsMiddleware, managerAccess, (req, res, next) => { accessRightsController.create(req, res, next); });
router.delete('/projects/:projectId/accessRights/:accessRightId', accessRightsMiddleware, managerAccess, (req, res, next) => { accessRightsController.delete(req, res, next); });

const trainingRequestService = new model.TrainingRequestService(blobService, tableService, queueService, projectService, trainingImageService);
const trainingRequestController = new api.TrainingRequestController(trainingRequestService);
router.get('/projects/:projectId/trainingRequests', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingRequestController.list(req, res, next); });
router.post('/projects/:projectId/trainingRequests', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingRequestController.create(req, res, next); });
router.delete('/projects/:projectId/trainingRequests/:requestId', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingRequestController.delete(req, res, next); });
router.get('/projects/:projectId/trainingRequests/:requestId/annotations.csv', accessRightsMiddleware, managerAccess, (req, res, next) => { trainingRequestController.export(req, res, next); });

const registeredUserMiddleware = new middleware.RegisteredUserAccessPolicy(accessRightsService);
app.use(
  '/api/vott/v1',
  connect_ensure_login.ensureLoggedIn(),
  registeredUserMiddleware,
  router
);

app.get('/vott',
  connect_ensure_login.ensureLoggedIn(),
  registeredUserMiddleware,
  (req, res, next) => {
    next();
  }
);

app.get('/tasks',
  connect_ensure_login.ensureLoggedIn(),
  registeredUserMiddleware,
  (req, res, next) => {
    next();
  }
);

app.use(require('serve-static')(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Listening on port ${PORT} (${process.env.VOTT_HOSTNAME}).`));
