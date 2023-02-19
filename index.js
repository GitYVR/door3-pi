const cors = require("cors");
const ethers = require("ethers");
const { hashMessage } = require("@ethersproject/hash");
const asyncHandler = require("express-async-handler");
const express = require("express");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const { Gpio } = require("onoff");

const openDoor = () => {
  try {
    const pin = new Gpio(17, "out");
    pin.writeSync(1);
    setTimeout(() => {
      pin.writeSync(0);
    }, 500);
  } catch (e) {
    console.log("Unable to connect with GPIO, running in simulation mode");
  }
};

const DOOR3_ABI = require("./abi/Door3.json");
const DOOR3_ADDRESS = "0x46d2495aa0329866A9ACd808634e27318674f31B";
const provider = new ethers.providers.JsonRpcProvider(
  "https://polygon-rpc.com"
);
const door3Contract = new ethers.Contract(DOOR3_ADDRESS, DOOR3_ABI, provider);

// **** Server ****

const hasValidMembership = async (address) => {
  const expiry = await door3Contract.expiry(address);
  const now = new Date().getTime();
  if (expiry.mul(1000).lt(now)) {
    return false;
  }
  return true;
};

// Payload structure example
// const payload = `{"timestamp":1676776147779,"message":"Open Door3"}`;
// const signature = `0xd9347e28239fb1b54527e5bb437d387253fd2d9b48da2af1d9d6dcebb8b904fb2afadd925730e2d43eb62111d1f4e23001fe29e623d57ff2fad9f6068f2cd8c71c`;

const app = express();
const port = 8888;

app.use(cors());
app.options("*", cors());
app.use(morgan("combined"));
app.use(bodyParser.json());

app.post(
  "/members/open",
  asyncHandler(async (req, res) => {
    if (!req.body.payload) {
      res.json({ error: "expect payload in body" }).status(400);
      return;
    }
    if (!req.body.signature) {
      res.json({ error: "expect signature in body" }).status(400);
      return;
    }
    const { payload, signature } = req.body;
    const payloadJson = JSON.parse(payload);

    if (payloadJson.message !== "Open Door3") {
      res.json({ error: "invalid payload" }).status(400);
      return;
    }

    if (!payloadJson.timestamp) {
      res.json({ error: "invalid payload" }).status(400);
      return;
    }

    try {
      parseInt(payloadJson.timestamp);
    } catch (e) {
      res.json({ error: "invalid payload" }).status(400);
      return;
    }

    // Timestamp can only be 5m old at most, payload timestamp is in ms
    // same as JS
    const payloadTimestamp = parseInt(payloadJson.timestamp);
    const fiveMinAgo = new Date().getTime() - 5 * 60 * 1000;

    if (payloadTimestamp < fiveMinAgo) {
      res.json({ error: "timestamp too old" }).status(400);
      return;
    }

    let signerAddress;
    try {
      signerAddress = ethers.utils.verifyMessage(payload, signature);
    } catch (e) {
      res.json({ error: "invalid signature" });
      return;
    }
    console.log(`[${signerAddress}] - Requested to open the door`);
    const validMembership = await hasValidMembership(signerAddress);

    if (!validMembership) {
      console.log(`[${signerAddress}] - Does not have valid membership`);
      res.json({ validMembership: false });
      return;
    }

    console.log(`[${signerAddress}] - Has a valid membership`);
    openDoor();
    res.json({ validMembership: true });
  })
);

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});
