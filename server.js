// Dépendances serveur et BDD
require("dotenv").config();
const express = require("express");
const formidable = require("express-formidable");
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const morgan = require("morgan");
const cors = require("cors");

const app = express();
app.use(formidable());
app.use(morgan("dev"));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

mongoose.connect(process.env.MONGO_DB_URI);

console.log("Bienvenue chez JD !!");

// Dépendances MDP
const SHA256 = require("crypto-js/sha256");
const encBase64 = require("crypto-js/enc-base64");
const uid2 = require("uid2");

//Création du modèle users
const User = mongoose.model("User", {
  email: String,
  account: {
    username: String,
    phone: String,
    avatar: Object, // nous verrons plus tard comment uploader une image
  },
  token: String,
  hash: String,
  salt: String,
});

//Create a user
app.post("/user/signup", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.fields.email });

    if (req.fields.username === undefined) {
      res.json({ message: "Please add a username !" });
    } else if (user !== null) {
      res.json({ message: "Email is already taken !" });
    } else {
      const password = req.fields.password;
      const salt = uid2(16);
      const hash = SHA256(req.fields.password + salt).toString(encBase64);
      const token = uid2(16);

      const newUser = new User({
        email: req.fields.email,
        token: token,
        hash: hash,
        salt: salt,
        account: {
          username: req.fields.username,
          phone: req.fields.phone,
        },
      });
      // ou : const newUser = new User(req.fileds) : possible car il s'agit d'un objet pour lequel on a un modèle

      await newUser.save();

      let newUserFront = {
        id: newUser.id,
        token: newUser.token,
        account: {
          username: newUser.account.username,
          phone: newUser.account.phone,
        },
      };
      res.json(newUserFront);
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// LOGIN ===========================================================================================================
app.post("/user/login", async (req, res) => {
  try {
    // user = getUser(email);
    const user = await User.findOne({ email: req.fields.email });
    // const hash = generateHash(user.salt, req.fields.password);
    const hash = SHA256(req.fields.password + user.salt).toString(encBase64);

    if (user.hash === hash) {
      //   setCookie(user.token);
      res.json({ message: `Bienvenue ${user.account.username} !` });
    } else {
      res.status(400).json({ message: "Wrong password !" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const isAuthenticated = async (req, res, next) => {
  if (req.headers.authorization) {
    const user = await User.findOne({
      token: req.headers.authorization.replace("Bearer ", ""),
    }).select("_id account");

    if (!user) {
      return res.status(401).json({ error: "Unauthorized - !user" });
    } else {
      // On crée une clé "user" dans req. La route dans laquelle le middleware est appelé     pourra avoir accès à req.user
      req.user = user;
      return next();
    }
  } else {
    return res
      .status(401)
      .json({ error: "Unauthorized - !header authorization" });
  }
};

// Création d'un modèle OFFER
const Offer = mongoose.model("Offer", {
  product_name: String,
  product_description: String,
  product_price: Number,
  product_details: Array,
  product_image: { type: mongoose.Schema.Types.Mixed, default: {} },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

//Poster une annonce
app.post("/offer/publish", isAuthenticated, async (req, res) => {
  //Il va falloir que le token existe et soit valide
  // const myToken = req.headers.authorization;
  // const isTokenValid = await User.findOne({ token: myToken });

  let pictureToUpload = req.files.picture.path;

  const newOffer = new Offer({
    product_name: req.fields.title,
    product_description: req.fields.description,
    product_price: req.fields.price,
    product_details: [
      { MARQUE: req.fields.brand },
      { TAILLE: req.fields.size },
      { ETAT: req.fields.condition },
      { COULEUR: req.fields.color },
      { EMPLACEMENT: req.fields.city },
    ],
    owner: req.user,
    // product_image: uploadedImage.secure_url,
  });

  const uploadedImage = await cloudinary.uploader.upload(pictureToUpload, {
    folder: `/vinted/offers/${newOffer._id}`,
  });

  newOffer.product_image = uploadedImage.secure_url;

  await newOffer.save();

  res.json(newOffer);
});

// Lister et filtrer les annonces
// Constante de filtrage
// function filter () {}
// Route
app.get("/offers", async (req, res) => {
  const offers = await Offer.find({
    product_name: new RegExp(req.query.title, "i"),
    product_price: { $gte: req.query.priceMin, $lte: req.query.priceMax },
  })
    .select("product_name product_price")
    .sort({ product_price: "asc" })
    .limit(4)
    .skip((Number(req.query.page) - 1) * 4); // -1 pour ne rien skiper à la page 1 ET *limit pour skiper une page entière si page > 1
  res.json(offers);
});

//Modifier une annonce=============================================
app.post("/offer/update", isAuthenticated, async (req, res) => {
  try {
    const isOfferExist = await Offer.findById(req.fields.id);

    if (!isOfferExist) {
      res.json({
        message: "This offer doesn't exist, foolish !",
      });
    } else {
      if (req.fields.title) {
        isOfferExist.product_name = req.fields.title;
      }
      if (req.fields.description) {
        isOfferExist.product_description = req.fields.description;
      }
      if (req.fields.price) {
        isOfferExist.product_price = req.fields.price;
      }
      if (req.fields.brand) {
        isOfferExist.product_details[0] = req.fields.brand;
      }
      if (req.fields.size) {
        isOfferExist.product_details[1] = req.fields.size;
      }
      if (req.fields.condition) {
        isOfferExist.product_details[2] = req.fields.condition;
      }
      if (req.fields.color) {
        isOfferExist.product_details[3] = req.fields.color;
      }
      if (req.fields.city) {
        isOfferExist.product_details[4] = req.fields.city;
      }
      if (req.files.picture) {
        //Supprimer l'ancienne photo
        cloudinary.api.delete_resources(isOfferExist.product_image);

        //Uploader la nouvelle photo
        let newPictureToUpload = req.files.picture.path;

        const result = await cloudinary.uploader.upload(newPictureToUpload, {
          public_id: `vinted/offers/${isOfferExist._id}`,
          // width: 400,
          // height: 400,
          // crop: "limit",
          // effect: "improve",
        });

        isOfferExist.product_image = result.secure_url;
      }

      await isOfferExist.save();
      res.json({
        message: `your offer ${isOfferExist.product_name} has been updated ! You are the unicorn of Vinted !`,
      });
    }
  } catch (error) {
    res.json({ message: error.message });
  }
});

// Lancement du serveur ========================
// app.listen(3000, () => {
//   console.log("Server has started :-)");
// });
app.listen(process.env.PORT, () => {
  console.log("Server has started");
});

//Interceptera toutes les routes qui n'existent pas
app.all("*", (request, response) => {
  response.json({ message: "Page not found" });
});
