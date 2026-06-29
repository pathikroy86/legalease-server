const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const port = process.env.PORT || 8008

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
const hiresCollection = database.collection("hires");
const commentsCollection = database.collection("comments");

// lawyer related apis
app.get('/api/lawyers', async (req, res) => {
    const query = {};

    if (req.query.search) {
        query.$or = [
            { name: { $regex: req.query.search, $options: 'i' } },
            { specialization: { $regex: req.query.search, $options: 'i' } },
            { city: { $regex: req.query.search, $options: 'i' } }
        ]
    }

    if (req.query.specialization && req.query.specialization !== 'all') {
        query.specialization = req.query.specialization;
    }

    if (req.query.status && req.query.status !== 'all') {
        query.status = req.query.status;
    }

    const sortOptions = {
        newest: { registeredAt: -1 },
        oldest: { registeredAt: 1 },
        feeLow: { consultationFee: 1 },
        feeHigh: { consultationFee: -1 },
        name: { name: 1 }
    }

    const sort = sortOptions[req.query.sort] || sortOptions.newest;
    const cursor = lawyersCollection.find(query).sort(sort);
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

app.get('/api/lawyers/:id', async (req, res) => {
    const id = req.params.id;
    const query = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { email: id };
    const result = await lawyersCollection.findOne(query);
    res.send(result || {});
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

// hire related apis
app.post('/api/hires', async (req, res) => {
    const hire = req.body;

    if (!hire?.lawyerId || !hire?.lawyerEmail || !hire?.clientEmail) {
        return res.status(400).send({ message: 'Lawyer and client information are required' })
    }

    const hiredAt = new Date();
    const newHire = {
        ...hire,
        status: 'pending',
        hiredAt,
        hiredDate: hiredAt.toISOString().split('T')[0],
        hiredTime: hiredAt.toTimeString().split(' ')[0],
    }

    const result = await hiresCollection.insertOne(newHire);
    res.send(result);
})

// comment related apis
app.get('/api/comments', async (req, res) => {
    const query = {};

    if (req.query.lawyerId) {
        query.lawyerId = req.query.lawyerId;
    }

    const cursor = commentsCollection.find(query).sort({ commentedAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})

app.post('/api/comments', async (req, res) => {
    const comment = req.body;

    if (!comment?.lawyerId || !comment?.userEmail || !comment?.comment) {
        return res.status(400).send({ message: 'Lawyer, user, and comment are required' })
    }

    const commentedAt = new Date();
    const newComment = {
        ...comment,
        commentedAt,
        commentedDate: commentedAt.toISOString().split('T')[0],
        commentedTime: commentedAt.toTimeString().split(' ')[0],
    }

    const result = await commentsCollection.insertOne(newComment);
    res.send(result);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
