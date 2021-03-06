const expressFoundation = require('../foundation/express');
const uuid = require('uuid/v4');

function TrainingImageController(trainingImageService) {
    this.trainingImageService = trainingImageService;
}

TrainingImageController.prototype.list = function (req, res, next) {
    const currentToken = req.query.currentToken ? JSON.parse(req.query.currentToken) : null;
    this.trainingImageService.list(req.params.projectId, currentToken, req.query.limit).then(result => {
        res.json(result);
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
};

TrainingImageController.prototype.allocate = function (req, res, next) {
    this.trainingImageService.allocate(req.body).then(image => {
        res.json(image);
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
};

TrainingImageController.prototype.create = function (req, res, next) {
    this.trainingImageService.create(req.body).then(image => {
        res.json(image);
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
};

TrainingImageController.prototype.stats = function (req, res, next) {
    const projectId = req.params.projectId;
    // TODO: Find a way to do these counts in one go, a la 'select status, count(*) from trainingimage group by status;'
    Promise.all([
        this.trainingImageService.count(projectId, 'tag-pending').then(count => Promise.resolve({ status: 'tag-pending', count: count })),
        this.trainingImageService.count(projectId, 'ready-for-training').then(count => Promise.resolve({ status: 'ready-for-training', count: count })),
        this.trainingImageService.count(projectId, 'in-conflict').then(count => Promise.resolve({ status: 'in-conflict', count: count }))
    ]).then(counts => {
        res.json({ statusCount: counts });
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
}

TrainingImageController.prototype.pullTask = function (req, res) {
    const projectId = req.params.projectId;
    this.trainingImageService.pullTask(projectId).then(task => {
        res.json(task);
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
}

TrainingImageController.prototype.pushTask = function (req, res) {
    const projectId = req.params.projectId;
    this.trainingImageService.pushTask(projectId, req.body, req.user).then(task => {
        res.json(task);
    }).catch(error => {
        expressFoundation.replyWithError(res, error);
    });
}

module.exports = TrainingImageController;
