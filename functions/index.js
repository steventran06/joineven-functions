/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const sgMail = require("@sendgrid/mail");

const firebaseConfig = {
  apiKey: "AIzaSyCEkxjmbrNK-468OCt2NbyDxZtu_zX8p7Y",
  authDomain: "even-396918.firebaseapp.com",
  projectId: "even-396918",
  storageBucket: "even-396918.appspot.com",
  messagingSenderId: "239166856185",
  appId: "1:239166856185:web:ef587ae14ea921de2b3b28",
  measurementId: "G-P43866PB95",
};
admin.initializeApp(firebaseConfig);
sgMail.setApiKey(
    "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",
);
exports.scheduleTest =
  onSchedule("every 24 hours", async (event) => {
    return admin
        .firestore()
        .collection("candidateProfile")
        .get()
        .then((candDocs)=>{
          const candidates = candDocs.docs.map((cP) => ({
            ...cP.data(),
            id: cP.id,
          }));

          admin
              .firestore()
              .collection("users")
              .get()
              .then((userDocs)=>{
                const users = userDocs.docs.map((cP) => ({
                  ...cP.data(),
                  id: cP.id,
                }));
                const allCandidatesId = candidates.map((cand) => cand.id);
                const usersWithoutCP = users.filter(
                    (user) =>
                      !allCandidatesId.includes(user.uid) &&
                    user.type === "candidate",
                );

                const usersWithoutCPNames = usersWithoutCP
                    .map((uwcp) => uwcp.displayName)
                    .join(", ");

                const newCandidateEmail = {
                  to: "steven@joineven.io",
                  from: "steven@joineven.io",
                  templateId: "d-ab48cb8e46e44974980a306cce24331b",
                  dynamicTemplateData: {
                    name: usersWithoutCPNames,
                  },
                };

                sgMail
                    .send(newCandidateEmail)
                    .then((response) => {
                      logger.log(response[0].statusCode);
                      logger.log(response[0].headers);
                    });
              },
              );
        });
  });
