require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());
// const { gameGen } = require("./utils/gameGen");
const { uploadJsonToPinata } = require("./utils/uploadJsonToPinata");
const { createPollTx } = require("./utils/createPollTx");
const { addQuizz } = require("./utils/addQuizz");
const { tweet } = require("./utils/tweet");
const { calcScore } = require("./utils/calcScore");
const OpenAI = require("openai");
const { imageGen } = require("./utils/imageGen");
const { uploadImageToPinata } = require("./utils/uploadImageToPinata");
const {
  getQuiz,
  getLeaderboard,
  getCompletedQuizzes,
  getQuizLeaderboard,
  getQuizzes,
  getTopScoreTokenReward,
} = require("./subgraph/queries");
const {
  createWalletClient,
  defineChain,
  createPublicClient,
  http,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const openai = new OpenAI({
  apiKey: process.env["HEURIST_API_KEY"],
  baseURL: "https://llm-gateway.heurist.xyz",
});
const ROBINX_CORE = "0x868d93b0Da22444100ADF128424bafF8B26500ff";
const ROBINX_CORE_ABI = [
  {
    inputs: [
      {
        internalType: "string",
        name: "_metadata",
        type: "string",
      },
      {
        internalType: "uint256",
        name: "tokenRewardAmount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "validity",
        type: "uint256",
      },
    ],
    name: "createPoll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "pollId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address",
      },
      {
        internalType: "uint8",
        name: "score",
        type: "uint8",
      },
    ],
    name: "mintRewards",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
const educhainTestnet = defineChain({
  id: 656476,
  name: "Educhain Testnet",
  network: "Educhain Testnet",
  nativeCurrency: { name: "Test EDU", symbol: "tEDU", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.open-campus-codex.gelato.digital"] },
  },
  blockExplorers: {
    default: {
      name: "Educain Testnet Explorer",
      url: "https://opencampus-codex.blockscout.com/",
    },
  },
  testnet: true,
});

const THEMES = [
  "pirate adventure on a mysterious blockchain sea",
  "cyberpunk metropolis with digital assets",
  "post-apocalyptic crypto survival",
  "space colony managing digital resources",
  "medieval crypto kingdom",
  "ninja academy teaching blockchain arts",
  "western frontier of digital gold rush",
  "underwater civilization using blockchain",
  "steampunk city with mechanical wallets",
  "ancient temple hiding crypto secrets",
];

function getSystemPrompt(index) {
  return `You are RobinX, an educational AI game master inspired by Nico Robin from One Piece. Create immersive Web3 educational games with diverse characters and settings.
  
    Scene requirements:
    - Vivid anime scene description with full environment and character positioning (MUST NOT HAVE close portraits)
    - Introduct unique dynamic character interactions (Atleast 2, including but not limited to Nico Robin) 
    - Must have 3 scenes total
    - Must have 2 converstations per scene and 1 question per scene
    - 3 options for multiple choice questions
    - Multiple choice option should be 1 or 2 words. NOT MORE THAN THAT.
    - Image prompt must have anime and within 120 characters
    - Speaker name should be one word
    - Use this theme for the game: ${THEMES[index]}
    
    Expected output format:
    {
    "topic": string,
    "gameTitle": string,
    "theme": string,
    "introduction": string,
    "scenes": [{
      "sceneId": number,
      "sceneDescription": string, 
      "imagePrompt": string,
      "conversations": [{
        "speaker": string,
        "dialogue": string
      }],
      "questions": [{
        "type": "multiple_choice" | "text_response",
        "questionText": string,
        "options": string[],
        "correctAnswer": string,
        "explanation": string
      }]
    }],
    "conclusion": string
  }`;
}

app.post("/api/image", async (req, res) => {
  const { prompt } = req.body;
  try {
    const url = await imageGen(prompt);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/calc-score", async (req, res) => {
  console.log(req.body);
  const { quiz, responses, address, pollId } = req.body;

  try {
    const { score } = await calcScore({
      quiz,
      responses,
    });

    try {
      const AI_AGENT_PRIVATE_KEY = process.env.AI_AGENT_PRIVATE_KEY;
      const account = privateKeyToAccount("0x" + AI_AGENT_PRIVATE_KEY);
      console.log(account.address);
      const walletClient = createWalletClient({
        account,
        chain: educhainTestnet,
        transport: http(),
      });

      const publicClient = createPublicClient({
        chain: educhainTestnet,
        transport: http(),
      });
      console.log({ args: [pollId, address, score] });
      const { request } = await publicClient.simulateContract({
        account,
        address: ROBINX_CORE,
        abi: ROBINX_CORE_ABI,
        functionName: "mintRewards",
        args: [pollId, address, score],
      });

      const tx = await walletClient.writeContract(request);
      const transaction = await publicClient.getTransactionReceipt({
        hash: tx,
      });

      console.log(transaction);
    } catch (e) {
      console.log("error in tx");
      console.log(e);
    }

    res.json({ score: Math.ceil(score) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-game", async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic is required" });
    const currentDate = new Date().toISOString();

    const games = [];
    console.log("Starting Game Generation");
    for (let i = 0; i < 1; i++) {
      const response = await openai.chat.completions.create({
        model: "mistralai/mixtral-8x7b-instruct",
        messages: [
          { role: "system", content: getSystemPrompt(i) },
          {
            role: "user",
            content: `Generate a complete educational game about: ${topic}`,
          },
        ],
        temperature: 0.8,
        max_tokens: 20000,
      });
      console.log("Generated Game ", i);
      console.log(response.choices[0]?.message?.content);
      const gameData = JSON.parse(
        response.choices[0]?.message?.content || "{}"
      );
      console.log(gameData);
      for (const scene of gameData.scenes) {
        const image = await imageGen(scene.imagePrompt);
        console.log("Image Generated");
        console.log(image);
        console.log({
          date: currentDate + "_" + scene.sceneId,
          image,
        });
        scene.imageUrl = await uploadImageToPinata(
          currentDate + "_" + scene.sceneId,
          image
        );
        console.log(scene.imageUrl);
      }
      games.push(gameData);
    }

    // if (!validateGameData(gameData)) {
    //   throw new Error("Generated game data failed validation");
    // }
    const quizzes_url = await uploadJsonToPinata(
      currentDate + "_quizzes",
      games
    );
    const metadata_url = await uploadJsonToPinata(currentDate + "_metadata", {
      name: "RobinX",
      description:
        "An autonomous AI agent that teaches web3 to users in the form of gamified quests.",
      topic: topic,
      date: currentDate,
    });

    const { txHash, pollId, reward } = await createPollTx(metadata_url);

    const tweetId = await tweet(
      "https://robinx-ai.vercel.app/embed?id=" + pollId
    );

    await addQuizz(
      pollId,
      quizzes_url,
      "https://x.com/EduRobinX/status/" + tweetId,
      reward.toString()
    );

    res.json({
      pollId,
      quizzes_url,
      metadata_url,
      tx: "https://edu-chain-testnet.blockscout.com/tx/" + txHash,
      tweet: "https://x.com/EduRobinX/status/" + tweetId,
    });
  } catch (error) {
    console.error("Error in generating game:", error);
    res.status(500).json({ error: "Failed to generate game" });
  }
});

app.get("/api/quiz", async (req, res) => {
  try {
    const quizzes = await getQuizzes();
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/quiz/:id", async (req, res) => {
  try {
    const quiz = await getQuiz(req.params.id);
    res.json(quiz);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/quiz/:id/leaderboard", async (req, res) => {
  try {
    const leaderboard = await getQuizLeaderboard(req.params.id);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/quiz/:id/top-score-token-reward", async (req, res) => {
  try {
    const topScoreTokenReward = await getTopScoreTokenReward(req.params.id);
    res.json(topScoreTokenReward);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/quiz/completed/:address", async (req, res) => {
  try {
    console.log(req.params.address);
    const quizzes = await getCompletedQuizzes(req.params.address);
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const leaderboard = await getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
