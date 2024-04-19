const express = require('express');
const app = express();
const cors = require('cors');
const mongoose = require('mongoose');
const { User, PDFFile } = require('./models/user.model'); // Import the user and PDFFile models from your models directory
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const {SecretManagerServiceClient} = require('@google-cloud/secret-manager').v1;
let connectionString = null;
let secret_sa = null;
const secretManagerClient = new SecretManagerServiceClient();

async function callGetSecret() {
  const request = {
    db_str: `projects/222322846740/secrets/pdf-mongodb-str/versions/latest`,
    sa: 'projects/222322846740/secrets/gcs-service-account/versions/latest'
  }

  try {

    // Run request
    const [version_db] = await secretManagerClient.accessSecretVersion({name: request.db_str});
    const [version_sa] = await secretManagerClient.accessSecretVersion({name: request.sa});
    const payload_db = version_db.payload.data.toString('utf8'); 
    const payload_sa = version_sa.payload.data.toString('utf8'); 
    // console.log(`Secret data: ${payload}`);
    connectionString = payload_db;
    secret_sa = payload_sa;
    console.log(connectionString);
    console.log(secret_sa);


    // Connect to MongoDB
    mongoose
    .connect(connectionString, {autoIndex: true})
    .then(() => {
      console.log('MongoDB connected');
    })
    .catch((error) => {
      console.error('MongoDB connection failed:', error);
    });

  } catch (error) {

    console.error('Fail to access secret or connect to mongoDB. ', error);
  }
}

callGetSecret();

const storage = new Storage({
  projectId: "pipelines-420101",
  keyFile: JSON.parse(secret_sa),
});

const bucketName = 'pdf-bucket-001';
const gcs = storage.bucket(bucketName);
const upload = multer({ storage: multer.diskStorage({}) });

app.use(cors()); // Enable Cross-Origin Resource Sharing (CORS)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets')));


// Register a new user
app.post('/api/register', async (req, res) => {
  console.log(req.body);
  try {
    const newPassword = await bcrypt.hash(req.body.password, 10);
    await User.create({
      name: req.body.name,
      email: req.body.email,
      password: newPassword,
    });
    res.json({ status: 'ok' });
  } catch (err) {
    res.json({ status: 'error', error: 'Duplicate email' });
  }
});

// Login a user
app.post('/api/login', async (req, res) => {
  const user = await User.findOne({
    email: req.body.email,
  });

  if (!user) {
    return res.json({ status: 'error', error: 'Invalid login' });
  }

  const isPasswordValid = await bcrypt.compare(
    req.body.password,
    user.password
  );

  if (isPasswordValid) {
    const token = jwt.sign(
      {
        name: user.name,
        email: user.email,
      },
      'secret123'
    );

    return res.json({ status: 'ok', user: token });
  } else {
    return res.json({ status: 'error', user: false });
  }
});

app.post('/upload-files', upload.single('file'), async (req, res) => {
  try {
    const title = req.body.title;
    const file = req.file;
    
    const storagepath = `assets/${req.file.originalname}`;
    
    // Upload the file to Google Cloud Storage
    const result = await gcs.upload(file.path, {
      destination: storagepath,
      // predefinedAcl: 'publicRead', // Set the file to be publicly readable
      metadata: {
        contentType: "application/pdf", // Adjust the content type as needed
      }
    });

    // Create a PDFFile document in your database
    await PDFFile.create({ title: title, pdf: file.originalname });

    // Send a success response to the client
    res.json({ status: 'ok', mediaLink: result[0].metadata.mediaLink });
  } catch (error) {
    console.error(error);
    // Send an error response to the client
    res.status(500).json({ error: 'Failed to upload file or create PDFFile document' });
  }
});


// Get a list of uploaded PDF files
app.get('/get-files', async (req, res) => {
  try {
    PDFFile.find({}).then((data) => {
      res.send({ status: 'ok', data: data });
    });
  } catch (error) {
    // Handle any errors
	console.error("Error",error.message)
  }
});

//  Endpoint to serve the PDF file
app.get('/pdf/:filename', async (req, res) => {
  const { filename } = req.params;
  // const filePath = path.join(__dirname, 'assets', filename);

  const file = gcs.file(`assets/${filename}`);
  const result = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60,
  });
  res.send(result[0]);
});

// Root endpoint
app.get('/', async (req, res) => {
  res.send('Success!!');
});

// Start the server
app.listen(3000, () => {
  console.log('Server started on port 3000');
});
