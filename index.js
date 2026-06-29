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
let connectPromise;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    serverSelectionTimeoutMS: 10000,
});

const connectDB = async () => {
    if (!uri) {
        throw new Error('MONGODB_URI is not defined')
    }

    if (!connectPromise) {
        connectPromise = client.connect();
    }

    return connectPromise;
}

const database = client.db(process.env.DB_NAME || "legalease");
const lawyersCollection = database.collection("lawyers");
const hiresCollection = database.collection("hires");
const commentsCollection = database.collection("comments");
const userProfilesCollection = database.collection("userProfiles");
const authUsersCollection = database.collection("user");

app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error(err);
        res.status(500).send({
            message: 'Database connection failed',
            error: err.code || err.message
        })
    }
})

app.get('/api/health', async (req, res) => {
    const ping = await database.command({ ping: 1 });
    res.send({
        message: 'Database connected',
        database: process.env.DB_NAME || 'legalease',
        ok: ping.ok
    })
})

// lawyer related apis
app.get('/api/lawyers', async (req, res) => {
    const query = {
        $or: [
            { approvalStatus: 'approved' },
            { approvalStatus: { $exists: false } }
        ]
    };

    if (req.query.search) {
        query.$and = [
            {
                $or: query.$or
            },
            {
                $or: [
                    { name: { $regex: req.query.search, $options: 'i' } },
                    { specialization: { $regex: req.query.search, $options: 'i' } },
                    { city: { $regex: req.query.search, $options: 'i' } }
                ]
            }
        ]
        delete query.$or;
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

app.get('/api/admin/lawyers', async (req, res) => {
    const query = {};

    if (req.query.approvalStatus && req.query.approvalStatus !== 'all') {
        query.approvalStatus = req.query.approvalStatus;
    }

    const cursor = lawyersCollection.find(query).sort({ registeredAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})

app.patch('/api/admin/lawyers/:id', async (req, res) => {
    const id = req.params.id;
    const lawyerInfo = req.body;

    if (!lawyerInfo?.approvalStatus) {
        return res.status(400).send({ message: 'Approval status is required' })
    }

    const query = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { email: id };
    const updatedDoc = {
        $set: {
            approvalStatus: lawyerInfo.approvalStatus,
            approvedAt: lawyerInfo.approvalStatus === 'approved' ? new Date() : null,
            reviewedAt: new Date()
        }
    }
    const result = await lawyersCollection.updateOne(query, updatedDoc);
    res.send(result);
})

app.get('/api/lawyers/featured', async (req, res) => {
    const lawyers = await lawyersCollection.aggregate([
        {
            $match: {
                $or: [
                    { approvalStatus: 'approved' },
                    { approvalStatus: { $exists: false } }
                ]
            }
        },
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
                approvalStatus: 1,
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
        ? {
            _id: new ObjectId(id),
            $or: [
                { approvalStatus: 'approved' },
                { approvalStatus: { $exists: false } }
            ]
        }
        : {
            email: id,
            $or: [
                { approvalStatus: 'approved' },
                { approvalStatus: { $exists: false } }
            ]
        };
    const result = await lawyersCollection.findOne(query);
    res.send(result || {});
})

app.get('/api/admin/lawyers/:id', async (req, res) => {
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
        approvalStatus: 'pending',
        registeredAt,
        registeredDate: registeredAt.toISOString().split('T')[0],
        registeredTime: registeredAt.toTimeString().split(' ')[0],
    }

    const result = await lawyersCollection.insertOne(newLawyer);
    res.send(result);
})


app.patch('/api/lawyers/:id', async (req, res) => {
    const id = req.params.id;
    const lawyer = req.body;
    const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { email: id };
    const updatedDoc = {
        $set: {
            name: lawyer.name,
            bio: lawyer.bio,
            consultationFee: Number(lawyer.consultationFee),
            specialization: lawyer.specialization,
            photoUrl: lawyer.photoUrl,
            status: lawyer.status || 'Available',
            city: lawyer.city || '',
            approvalStatus: lawyer.approvalStatus || 'pending',
            updatedAt: new Date()
        }
    }
    const result = await lawyersCollection.updateOne(filter, updatedDoc);
    res.send(result);
})

app.delete('/api/lawyers/:id', async (req, res) => {
    const id = req.params.id;
    const query = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { email: id };
    const result = await lawyersCollection.deleteOne(query);
    res.send(result);
})
// user profile related apis
app.get('/api/user-profile', async (req, res) => {
    const query = {};

    if (req.query.email) {
        query.email = req.query.email;
    }

    if (!query.email) {
        return res.status(400).send({ message: 'Email is required' })
    }

    const result = await userProfilesCollection.findOne(query);
    res.send(result || {});
})

app.patch('/api/user-profile', async (req, res) => {
    const profile = req.body;

    if (!profile?.email || !profile?.name) {
        return res.status(400).send({ message: 'Email and name are required' })
    }

    const filter = { email: profile.email };
    const updatedDoc = {
        $set: {
            name: profile.name,
            image: profile.image || '',
            email: profile.email,
            updatedAt: new Date()
        },
        $setOnInsert: {
            createdAt: new Date()
        }
    }
    const result = await userProfilesCollection.updateOne(filter, updatedDoc, { upsert: true });
    await authUsersCollection.updateOne(
        { email: profile.email },
        {
            $set: {
                name: profile.name,
                image: profile.image || '',
                updatedAt: new Date()
            }
        }
    );
    res.send(result);
})

// admin related apis
app.get('/api/admin/users', async (req, res) => {
    const authUsers = await authUsersCollection.find().sort({ createdAt: -1 }).toArray();
    const profiles = await userProfilesCollection.find().toArray();
    const profileMap = new Map(profiles.map((profile) => [profile.email, profile]));

    const users = authUsers.map((user) => {
        const profile = profileMap.get(user.email) || {};

        return {
            _id: user._id,
            id: user.id || user._id,
            name: profile.name || user.name || user.email?.split('@')[0] || 'LegalEase User',
            email: user.email,
            role: user.role || profile.role || 'user',
            image: profile.image || user.image || '',
            createdAt: user.createdAt || profile.createdAt || '',
        }
    })

    res.send(users);
})

app.patch('/api/admin/users/:id', async (req, res) => {
    const id = req.params.id;
    const userInfo = req.body;

    if (!userInfo?.role) {
        return res.status(400).send({ message: 'Role is required' })
    }

    const query = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { id }, { email: id }] }
        : { $or: [{ id }, { email: id }] };

    const updatedDoc = {
        $set: {
            role: userInfo.role,
            updatedAt: new Date()
        }
    }

    const result = await authUsersCollection.updateOne(query, updatedDoc);

    if (userInfo.email) {
        await userProfilesCollection.updateOne(
            { email: userInfo.email },
            {
                $set: {
                    role: userInfo.role,
                    email: userInfo.email,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    }

    res.send(result);
})

app.delete('/api/admin/users/:id', async (req, res) => {
    const id = req.params.id;
    const email = req.query.email;
    const query = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { id }, { email: id }] }
        : { $or: [{ id }, { email: id }] };

    const result = await authUsersCollection.deleteOne(query);

    if (email) {
        await userProfilesCollection.deleteOne({ email });
        await lawyersCollection.deleteOne({ email });
    }

    res.send(result);
})

app.get('/api/admin/analytics', async (req, res) => {
    const totalUsers = await authUsersCollection.countDocuments();
    const totalLawyers = await lawyersCollection.countDocuments();
    const totalHires = await hiresCollection.countDocuments();

    res.send({
        totalUsers,
        totalLawyers,
        totalHires
    });
})

// hire related apis
app.get('/api/hires', async (req, res) => {
    const query = {};

    if (req.query.lawyerId) {
        query.lawyerId = req.query.lawyerId;
    }

    if (req.query.clientEmail) {
        query.clientEmail = req.query.clientEmail;
    }

    if (req.query.lawyerEmail) {
        query.lawyerEmail = req.query.lawyerEmail;
    }

    const cursor = hiresCollection.find(query).sort({ hiredAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})

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


app.patch('/api/hires/:id', async (req, res) => {
    const id = req.params.id;
    const hireInfo = req.body;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
        $set: {
            status: hireInfo.status,
            updatedAt: new Date()
        }
    }
    const result = await hiresCollection.updateOne(filter, updatedDoc);
    res.send(result);
})
// comment related apis
app.get('/api/comments', async (req, res) => {
    const query = {};

    if (req.query.lawyerId) {
        query.lawyerId = req.query.lawyerId;
    }

    if (req.query.userEmail) {
        query.userEmail = req.query.userEmail;
    }

    const cursor = commentsCollection.find(query).sort({ commentedAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})

app.post('/api/comments', async (req, res) => {
    const comment = req.body;

    if (!comment?.lawyerId || !comment?.lawyerEmail || !comment?.userEmail || !comment?.comment) {
        return res.status(400).send({ message: 'Lawyer, user, and comment are required' })
    }

    const hireQuery = {
        clientEmail: comment.userEmail,
        $or: [
            { lawyerId: comment.lawyerId },
            { lawyerEmail: comment.lawyerEmail }
        ]
    }
    const hiredLawyer = await hiresCollection.findOne(hireQuery);

    if (!hiredLawyer) {
        return res.status(403).send({ message: 'Only users who have hired this lawyer can comment.' })
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

app.patch('/api/comments/:id', async (req, res) => {
    const id = req.params.id;
    const commentInfo = req.body;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
        $set: {
            comment: commentInfo.comment,
            updatedAt: new Date()
        }
    }
    const result = await commentsCollection.updateOne(filter, updatedDoc);
    res.send(result);
})

app.delete('/api/comments/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await commentsCollection.deleteOne(query);
    res.send(result);
})

if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Example app listening on port ${port}`)
    })
}

module.exports = app;

