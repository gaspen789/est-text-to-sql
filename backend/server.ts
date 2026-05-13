import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { modelsRouter } from './routes/models.js';
import { languagesRouter } from './routes/languages.js';
import { modalitiesRouter } from './routes/modalities.js';
import { apisRouter } from './routes/apis.js';
import { pricingRouter } from './routes/pricing.js';
import { chatsRouter } from './routes/chats.js';
import { usersRouter } from './routes/users.js';
import { classifiersRouter } from './routes/classifiers.js';
import { databasesRouter } from './routes/databases.js';
import { chatRouter } from './routes/chat.js';
import { adminChatsRouter } from './routes/admin-chats.js';
import { adminDataAccessRouter } from './routes/admin-data-access.js';
import { userDataStructureRouter } from './routes/user-data-structure.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 31869;

const app = express();
app.use(cors());
app.use(express.json());

app.use(authRouter);
app.use(modelsRouter);
app.use(languagesRouter);
app.use(modalitiesRouter);
app.use(apisRouter);
app.use(pricingRouter);
app.use(chatsRouter);
app.use(usersRouter);
app.use(classifiersRouter);
app.use(databasesRouter);
app.use(chatRouter);
app.use(adminChatsRouter);
app.use(adminDataAccessRouter);
app.use(userDataStructureRouter);

const server = app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
