const { cloudinary } = require("../lib/cloudinary");
const { generateToken } = require("../lib/utils");
const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const cloudianry = require("../lib/cloudinary");

module.exports= {
    signup: async (req, res) => {
        const {fullName, email, password} = req.body;
        try {
            if(!fullName || !email || !password) {
                return res.status(400).json({message: "Please provide all required fields"});
            }

           if(password.length < 6) {
                return res.status(400).json({message: "Password must be at least 6 characters long"});
            }

            const user = await User.findOne({email});
            if( user) {
                return res.status(400).json({message: "Email already exists"});
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const newUser = new User({
                fullName,
                email,
                password: hashedPassword,
            })

            if(newUser) {
                await newUser.save();
                generateToken(newUser._id, res);

                res.status(201).json({
                    _id: newUser._id,
                    fullName: newUser.fullName,
                    email: newUser.email,
                    profilePic: newUser.profilePic,
                });


            } else {
                return res.status(400).json({message: "Invalid user data"});
            }
        } catch (error) {
            console.error("Error in signup:", error.message);
            res.status(500).json({message: "Server error"});
        }
    },
    login: async (req, res) => {
        const {email, password} = req.body;
        try {
            const user = await User.findOne({email});

            if(!user){
                return res.status(400).json({message: "Invalid credentials"});
            }

            const isPasswordCorrect = await bcrypt.compare(password, user.password);

            if(!isPasswordCorrect) {
                return res.status(400).json({message: "Invalid credentials"});
            }
            generateToken(user._id, res);

            res.status(200).json({
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                profilePic: user.profilePic,
            });

        } catch (error) {
            console.error("Error in login:", error.message);
            res.status(500).json({message: "Server error"});
        }
    },
    logout: (req, res) => {
        try {
            res.cookie("jwt", "", {maxAge : 0});
            res.status(200).json({message: "Logged out successfully"});
        } catch (error) {
            console.error("Error in logout:", error.message);
            res.status(500).json({message: "Server error"});
        }
    },

    updateProfile : async (req, res) => {
        try {
            const {profilePic} = req.body;

            const userId = req.user._id;

            if(!profilePic) {
                return res.status(400).json({message: "Profile picture URL is required"});
            }

            const uploadResponse = await cloudinary.uploader.upload(profilePic)

            const updatedUser = await User.findByIdAndUpdate(userId, {profilePic:uploadResponse.secure_url}, {new: true});

            res.status(200).json(updatedUser)
        } catch (error) {
            console.error("Error in updateProfile:", error.message);
            res.status(500).json({message: "Server error"});
        }
    },

    checkAuth : (req, res) => {
        try {
            res.status(200).json(req.user);

        } catch (error) {
            console.loge.error("Error in checkAuth:", error.message);
            res.status(500).json({message: "Server error"});
        }
    }

}