import { Modules } from "@medusajs/framework/utils";
import { backupStatus, queueBackup, resumeAfterFailedRestore } from "./database-backups";
import { validBackupId } from "./database-backup-policy";
export async function cmsBackups(req:any,res:any) {
  const user=await req.scope.resolve(Modules.USER).retrieveUser(req.auth_context.actor_id);
  if(user.metadata?.isAdmin!==true) return res.status(403).json({message:"Only administrators can manage database backups."});
  try {
    if(req.method==="GET") return res.json(await backupStatus());
    if(req.body.action==="backup_create") return res.status(202).json({operation:await queueBackup("backup")});
    if(req.body.action==="backup_restore") {
      if(!validBackupId(req.body.backupId) || req.body.confirmation!==`RESTORE ${req.body.backupId}`) return res.status(400).json({message:"Confirm the selected backup before restoring."});
      return res.status(202).json({operation:await queueBackup("restore",req.body.backupId)});
    }
    if(req.body.action==="backup_resume" && req.body.confirmation==="RESUME") {
      await resumeAfterFailedRestore(); return res.json({ok:true});
    }
    return res.status(400).json({message:"Unknown backup action."});
  } catch(error) { return res.status(409).json({message:error instanceof Error?error.message:"Backup operation failed."}); }
}
