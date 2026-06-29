const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const port = process.env.PORT || 8008

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');

app.get('/', (req, res) => {
    res.send('Hello World!')
})

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    serverSelectionTimeoutMS: 10000,
});

client.connect(() => {
    console.log('connecting to MOngo db');
}).catch(console.dir)

const database = client.db(process.env.DB_NAME || "legalease");
const lawyersCollection = database.collection("lawyers");

// lawyer related apis
app.get('/api/lawyers', async (req, res) => {
    const cursor = lawyersCollection.find().sort({ registeredAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})
app.get('/api/lawyers/featured', async (req, res) => {
    const lawyers = await lawyersCollection.aggregate([
        { $sample: { size: 6 } },
        {
            $project: {
                name: 1,
                email: 1,
                photoUrl: 1,
                specialization: 1,
                bio: 1,
                consultationFee: 1,
                status: 1,
                city: 1,
                registeredAt: 1,
                registeredDate: 1,
                registeredTime: 1
            }
        }
    ]).toArray();

    res.send(lawyers);
})

app.post('/api/lawyers', async (req, res) => {
    const lawyer = req.body;

    if (!lawyer?.name || !lawyer?.email || !lawyer?.photoUrl || !lawyer?.specialization || !lawyer?.bio || !lawyer?.consultationFee || !lawyer?.status || !lawyer?.city) {
        return res.status(400).send({
            message: 'Name, email, photo URL, specialization, bio, consultation fee, status, and city are required'
        })
    }

    const registeredAt = new Date();
    const newLawyer = {
        name: lawyer.name,
        email: lawyer.email,
        photoUrl: lawyer.photoUrl,
        specialization: lawyer.specialization,
        bio: lawyer.bio,
        consultationFee: Number(lawyer.consultationFee),
        status: lawyer.status,
        city: lawyer.city,
        registeredAt,
        registeredDate: registeredAt.toISOString().split('T')[0],
        registeredTime: registeredAt.toTimeString().split(' ')[0],
    }

    const result = await lawyersCollection.insertOne(newLawyer);
    res.send(result);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

