/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const request = require("request");
const {DateTime} = require("luxon");
const logger = require("firebase-functions/logger");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const sgMail = require("@sendgrid/mail");
require('dotenv').config({ path: '../.env' });

const firebaseConfig = {
  apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.PUBLIC_FIREBASE_APPID,
  measurementId: process.env.PUBLIC_FIREBASE_MEASUREMENT_ID,
};
admin.initializeApp(firebaseConfig);
sgMail.setApiKey(
    process.env.SENDGRID_API_KEY,
);

const getTimeAgo = (date) => {
  const seconds = Math.floor(
      (new Date().getTime() - new Date(date).getTime()) / 1000,
  );
  return seconds;
};

const delay = (t, val) =>
  new Promise((resolve) => setTimeout(resolve, t, val));

const getCurrentTimeStamp = () => {
  return DateTime.now().setZone("America/Los_Angeles").toISO();
};

const addToCollection = async (collection, itemToAdd) => {
  await admin
      .firestore()
      .collection(collection)
      .add(itemToAdd)
      .catch((error) => {
        console.error(error);
      });
};

const deleteItemInCollection = async (collection, collectionId) => {
  await admin
      .firestore()
      .collection(collection)
      .doc(collectionId)
      .delete()
      .catch((error) => {
        console.error(error);
      });
};

const sendNotification = async (userId, notification) => {
  const {title, body, link} = notification;
  await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .collection("notifications")
      .add({
        title,
        body,
        link,
        createdAt: getCurrentTimeStamp(),
        viewed: false,
      })
      .catch((error) => {
        console.error(error);
      });
};

exports.sendNewUserEmail = onDocumentCreated("users/{userId}", (event) =>{
  const userId = event.params.userId;
  return admin.firestore().collection("users").doc(userId).get().then((doc)=>{
    const userInfo = doc.data();
    const {email, firstName, lastName, type} = userInfo;

    const userSignupEmail = {
      to: email,
      from: "steven@joineven.io",
      templateId: type === "recruiter" ?
        "d-06e7b7cfae3c4d838f558c24e5023058" :
        "d-23d9069634bd45c5999a2c909c0cd77f",
      dynamicTemplateData: {
        name: firstName,
      },
    };

    const newCandidateEmail = {
      to: "team@joineven.io",
      from: "steven@joineven.io",
      templateId: "d-ab48cb8e46e44974980a306cce24331b",
      dynamicTemplateData: {
        name: `${firstName} ${lastName}`,
      },
    };

    sgMail
        .send(userSignupEmail)
        .then((response) => {
          // Send an email with candidate name to
          // Team Even when new candidates sign up
          if (type === "candidate") {
            sgMail
                .send(newCandidateEmail)
                .then((response) => {
                  logger.log(response[0].statusCode);
                  logger.log(response[0].headers);
                });
          }
          logger.log(response[0].statusCode);
          logger.log(response[0].headers);
        })
        .catch((error) => {
          logger.error(error);
        });
  });
});


exports.sendNotificationEmail =
  onDocumentCreated("users/{userId}/notifications/{notificationId}", (event) => {
    // ID of newly created document
    const userId = event.params.userId;
    const notificationId = event.params.notificationId;
    return admin
        .firestore()
        .collection("users")
        .doc(userId)
        .collection("notifications")
        .doc(notificationId)
        .get()
        .then((notification)=>{
          // Retrieve value from notification data
          const {body, title, link} = notification.data();

          const buttonHash = {
            ["Candidate has Applied on Website"]: "View their profile!",
            ["New Candidate Interest"]: "View their profile!",
            ["Mutual Interest Received"]: "Reach out to this candidate!",
            ["Interest Rejected"]: "Manage your job queue",
            ["Recruiter Has Withdrawn Their Interest"]: "Manage your job queue",
            ["A Company Has Expressed Interest in You"]: "Manage your job queue",
            ["Job Reported Closed"]: "Check your position status",
            ["Job Post Has Been Removed"]: "Manage your job queue",
          };

          // Don't need to send email for job recommendation notifications.
          if (title !== "You Have a New Job Recommendation!") {
            return admin
                .firestore()
                .collection("users")
                .doc(userId)
                .get()
                .then((user)=>{
                  const {email, firstName} = user.data();
                  const msg ={
                    to: email,
                    from: "steven@joineven.io",
                    templateId: "d-bb636e69a03841b8bf0858fcd4b1cc53",
                    dynamicTemplateData: {
                      name: firstName,
                      subject: title,
                      body,
                      preheader: body,
                      link,
                      button: buttonHash[title] || "Back to Even",
                    },
                  };
                  sgMail
                      .send(msg)
                      .then((response) => {
                        logger.log(response[0].statusCode);
                        logger.log(response[0].headers);
                      })
                      .catch((error) => {
                        logger.error(error);
                      });
                });
          }
        });
  });

exports.reminderEmail =
  onSchedule("every day 09:23", async (event) => {
    return await admin
        .firestore()
        .collection("candidateProfile")
        .get()
        .then( async (candDocs)=>{
          const candidates = candDocs.docs.map((cP) => ({
            ...cP.data(),
            id: cP.id,
          }));

          await admin
              .firestore()
              .collection("users")
              .get()
              .then( async (userDocs)=>{
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

                usersWithoutCP.forEach((user) => {
                  const userCreatedTime = getTimeAgo(user.createdAt);

                  // 24 hour reminder
                  if (userCreatedTime > 86400 && userCreatedTime < 172800) {
                    const day1Reminder = {
                      to: user.email,
                      from: "steven@joineven.io",
                      templateId: "d-9862703c78fe473f8ea241df6674bab3",
                      dynamicTemplateData: {
                        name: user.firstName,
                        rid: user.recruiterId,
                        subject: "Complete Your Profile to Unlock Exclusive Benefits on Even",
                        preheader: "Unlock Direct Access To Recruiting Teams at Great Startups!",
                        body: "We noticed you started your journey on Even but haven't yet completed your profile. Completing your profile is key to unlocking a host of exclusive benefits designed to propel your career forward:",
                      },
                    };

                    sgMail
                        .send(day1Reminder)
                        .then((response) => {
                          logger.log(response[0].statusCode);
                          logger.log(response[0].headers);
                        });
                  // 72 hour reminder
                  } else if (userCreatedTime > 259200 && userCreatedTime < 345600) {
                    const day3Reminder = {
                      to: user.email,
                      from: "steven@joineven.io",
                      templateId: "d-9862703c78fe473f8ea241df6674bab3",
                      dynamicTemplateData: {
                        name: user.firstName,
                        rid: user.recruiterId,
                        subject: "Complete Your Profile To Get Job Recommendations",
                        preheader: "Great Jobs Are Waiting for You!",
                        body: "Quick reminder to complete your profile to get access to our platform! Once you finish up, you’ll get:",
                      },
                    };

                    sgMail
                        .send(day3Reminder)
                        .then((response) => {
                          logger.log(response[0].statusCode);
                          logger.log(response[0].headers);
                        });
                  // 1 week reminder
                  } else if (userCreatedTime > 604800 && userCreatedTime < 691200) {
                    const weekReminder = {
                      to: user.email,
                      from: "steven@joineven.io",
                      templateId: "d-9862703c78fe473f8ea241df6674bab3",
                      dynamicTemplateData: {
                        name: user.firstName,
                        rid: user.recruiterId,
                        subject: "Last Reminder To Get Access To Remote Jobs at Great Startups!",
                        preheader: "Get Referred to the Perfect Job Today.",
                        body: "Last reminder to complete your profile to get access to our platform! Once you finish up, you’ll get:",
                      },
                    };

                    sgMail
                        .send(weekReminder)
                        .then((response) => {
                          logger.log(response[0].statusCode);
                          logger.log(response[0].headers);
                        });
                  }
                });
              });
        });
  });

exports.checkForDeadPositions =
  onSchedule("every 24 hours", async (event) => {
    const deletedPositions = [];
    const deletedMutualInterest = [];
    const unknownStatus = [];
    await admin
        .firestore()
        .collection("mutualInterest")
        .get()
        .then( async (mIDocs) => {
          // Gather all mutual interests
          const allMutualInterests = mIDocs.docs.map((mI) => ({
            ...mI.data(),
            id: mI.id,
          }));
          await admin
              .firestore()
              .collection("position")
              .get()
              .then(async (posDocs)=>{
                // Gather all positions
                const positions = posDocs.docs.map((pos) => ({
                  ...pos.data(),
                  id: pos.id,
                }));
                // For all positions, we are going to check position.link for status code
                for (const pos of positions) {
                  await Promise.all([
                    request(pos.link, async (error, response, body) => {
                      // If status code for position link is 404, we will delete the position
                      if (response && response.statusCode === 404) {
                        deletedPositions.push({
                          id: pos.id,
                          company: pos.company,
                          name: pos.name,
                          link: pos.link,
                          statusCode: response.statusCode,
                        });
                        await deleteItemInCollection("position", pos.id)
                            .then(async () => {
                              logger.log(`Position ${pos.id}: ${pos.company} - ${pos.name} - DELETED`);

                              // We need to find all mutualInterest records
                              // that were connected to this deleted position
                              const mutualInterestMatch =
                              allMutualInterests.filter(
                                  (mi) => mi.positionId === pos.id,
                              );
                              return Promise.all(
                                  mutualInterestMatch.map(async (miMatch) => {
                                    const candidateNotification = {
                                      title: "Job Post Has Been Removed",
                                      body: `We're just letting you know that the ${pos.name} position at ${pos.company} has been filled or cancelled. Please continue looking for new positions!`,
                                      link: `https://app.joineven.io/user/positions`,
                                    };
                                    // For all matching mutualInterest records, we will delete them
                                    // and send a notification to any user that has express
                                    return await deleteItemInCollection("mutualInterest", miMatch.id)
                                        .then( async () => {
                                          logger.log(`Mutual Interest ${miMatch.id} - DELETED`);
                                          deletedMutualInterest.push({
                                            id: miMatch.id,
                                            candidate: miMatch.candidateId,
                                            position: miMatch.positionId,
                                          });
                                          logger.log(`Candidate ${miMatch.candidateId} - NOTIFIED: ${JSON.stringify(candidateNotification)}`);
                                          return await sendNotification(
                                              miMatch.candidateId,
                                              candidateNotification,
                                          );
                                        });
                                  }),
                              );
                            });
                      // We will send all jobs that are not 404 or 200 in an email for review
                      } else if (response && response.statusCode !== 200) {
                        unknownStatus.push({
                          id: pos.id,
                          company: pos.company,
                          name: pos.name,
                          link: pos.link,
                          statusCode: response.statusCode,
                        });
                      }
                    }),
                    delay(2000),
                  ]);
                }
              });
        });
    const deadJobs = {
      to: "team@joineven.io",
      from: "steven@joineven.io",
      templateId: "d-03a0eed2788f470284cb95e1806204d2",
      dynamicTemplateData: {
        unknownStatus,
        deletedPositions,
        deletedMutualInterest,
      },
    };

    sgMail
        .send(deadJobs)
        .then((response) => {
          logger.log(response[0].statusCode);
          logger.log(response[0].headers);
        });
  });

exports.sendRecommendations =
  // Monday and Wednesdays
  onSchedule("0 8 * * 1,3", async (event) => {
    await admin
        .firestore()
        .collection("candidateProfile")
        .get()
        .then( async (candDocs) => {
          // Gather all candidate profiles
          const allCandidateProfiles = candDocs.docs.map((cand) => ({
            ...cand.data(),
            id: cand.id,
          }));

          logger.log("allCandidateProfiles", JSON.stringify(allCandidateProfiles));
          await admin
              .firestore()
              .collection("position")
              .get()
              .then( async (posDocs) => {
                // Gather all positions
                const allPositions = posDocs.docs.map((pos) => ({
                  ...pos.data(),
                  id: pos.id,
                }));

                await admin
                    .firestore()
                    .collection("mutualInterest")
                    .get()
                    .then( async (miDocs) => {
                      // Gather all mutual interest
                      const allMutualInterests = miDocs.docs.map((mI) => ({
                        ...mI.data(),
                        id: mI.id,
                      }));
                      allCandidateProfiles.forEach( async (candidate) => {
                        const recommendedPositions = allPositions
                            .filter((posFil) => {
                              // Don't want to recommend if there is existing mutual interest already
                              const hasMutualInterest = allMutualInterests.find(
                                  (mI) => mI.candidateId === candidate.id && mI.positionId === posFil.id,
                              );
                              // CANDIDATE and POSITION fields should match
                              const fieldMatch = posFil.field === candidate.field;
                              let locationMatch;
                              const willingToRelocate =
                                candidate.relocate === "Yes - open to relocation" ||
                                candidate.relocate ===
                                  "Yes - for the right opportunity";

                              // If the POSITION does not have remote working, CANDIDATE and POSITION have to be in the same location
                              if (!posFil.workPref.includes("Remote")) {
                                locationMatch = posFil.location.includes(candidate.location);
                                // If CANDIDATE is willing to relocate, we can match on any location
                              } else if (willingToRelocate) {
                                locationMatch = true;
                                // Otherwise we have to match one of the workPref arrays.
                              } else {
                                candidate.workPref.forEach((pref) => {
                                  if (posFil.workPref.includes(pref)) {
                                    locationMatch = true;
                                  }
                                });
                              }
                              return fieldMatch && locationMatch && !hasMutualInterest;
                            })
                            // Only recommend 3 jobs at a time
                            .slice(0, 3);

                        logger.log("recommendedPositions", JSON.stringify(recommendedPositions));

                        if (recommendedPositions.length > 0) {
                          recommendedPositions.forEach( async (pos) => {
                            // Create a new mutualInterest relationship between position and candidate
                            const mutualInterestRecommendedJob = {
                              candidateId: candidate.id,
                              positionId: pos.id,
                              createdAt: getCurrentTimeStamp(),
                              lastUpdated: getCurrentTimeStamp(),
                              applied: false,
                              recommended: true,
                              status: "Recommended Job",
                            };
                            await addToCollection("mutualInterest", mutualInterestRecommendedJob)
                                .then( async () => {
                                  logger.log("mutualInterest created", JSON.stringify(mutualInterestRecommendedJob));
                                  const recommendedJobNotification = {
                                    title: "You Have a New Job Recommendation!",
                                    body: `We think that the ${pos.name} position at ${pos.company} would be a great fit for you! See if this position would be a good fit.`,
                                    link: `https://app.joineven.io/user/position/${pos.id}`,
                                  };
                                  await sendNotification(candidate.id, recommendedJobNotification);
                                  logger.log("recommendedJobNotification", JSON.stringify(recommendedJobNotification));
                                });
                          });

                          const recommendations = {
                            to: candidate.email,
                            from: "steven@joineven.io",
                            templateId: "d-694da3cfde814de6b99a34785de6bd7a",
                            dynamicTemplateData: {
                              name: candidate.firstName,
                              positions: recommendedPositions,
                            },
                          };

                          await sgMail
                              .send(recommendations)
                              .then((response) => {
                                logger.log(response[0].statusCode);
                                logger.log(response[0].headers);
                              });
                        }
                      });
                    });
              });
        });
  });
