'use strict';

const express = require('express');
const multer  = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post('/', upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const processed = req.files.map((file) => {
    const isImage = file.mimetype.startsWith('image/');
    const isPDF   = file.mimetype === 'application/pdf';
    return {
      name:      file.originalname,
      size:      file.size,
      mediaType: file.mimetype,
      type:      isImage ? 'image' : isPDF ? 'pdf' : 'text',
      data:      file.buffer.toString('base64'),
    };
  });

  res.json({ files: processed });
});

module.exports = router;
