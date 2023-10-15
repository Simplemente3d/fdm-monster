import { createController } from "awilix-express";
import { AppConstants } from "@/server.constants";
import { authenticate, authorizeRoles } from "@/middleware/authenticate";
import { ROLES } from "@/constants/authorization.constants";
import { validateInput } from "@/handlers/validators";
import { idRules } from "./validation/generic.validation";
import { AuthorizationError, BadRequestException, InternalServerException } from "@/exceptions/runtime.exceptions";
import { IConfigService } from "@/services/core/config.service";
import { IUserService } from "@/services/interfaces/user-service.interface";
import { Request, Response } from "express";
import { demoUserNotAllowed, demoUserNotAllowedInterceptor } from "@/middleware/demo.middleware";
import { IRoleService } from "@/services/interfaces/role-service.interface";

export class UserController {
  userService: IUserService;
  roleService: IRoleService;
  configService: IConfigService;

  constructor({
    userService,
    configService,
    roleService,
  }: {
    userService: IUserService;
    configService: IConfigService;
    roleService: IRoleService;
  }) {
    this.userService = userService;
    this.configService = configService;
    this.roleService = roleService;
  }

  async profile(req: Request, res: Response) {
    if (!req.user?.id) {
      res.send({});
      return;
    }

    const user = await this.userService.getUser(req.user?.id);
    res.send(this.userService.toDto(user));
  }

  async list(req: Request, res: Response) {
    const users = await this.userService.listUsers();
    res.send(users.map((u) => this.userService.toDto(u)));
  }

  async listRoles(req: Request, res: Response) {
    const roleDtos = this.roleService.roles.map((r) => this.roleService.toDto(r));
    res.send(roleDtos);
  }

  async delete(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);

    if (req.user?.id === id) {
      throw new InternalServerException("Not allowed to delete your own account");
    }

    if (this.configService.isDemoMode()) {
      const demoUserId = await this.userService.getDemoUserId();
      if (id === demoUserId) {
        this.throwIfDemoMode();
      }
    }

    await this.userService.deleteUser(id);
    res.send();
  }

  async get(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);
    const user = await this.userService.getUser(id);
    res.send(this.userService.toDto(user));
  }

  async changeUsername(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);

    if (req.user?.id !== id) {
      throw new InternalServerException("Not allowed to change username of other users");
    }

    const { username } = await validateInput(req.body, {
      username: "required|string",
    });
    await this.userService.updateUsernameById(id, username);
    res.send();
  }

  async changePassword(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);

    if (req.user?.id !== id) {
      throw new InternalServerException("Not allowed to change password of other users");
    }

    const { oldPassword, newPassword } = await validateInput(req.body, {
      oldPassword: "required|string",
      newPassword: "required|string",
    });
    await this.userService.updatePasswordById(id, oldPassword, newPassword);
    res.send();
  }

  async setVerified(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);

    const ownUserId = req.user?.id;
    if (ownUserId) {
      if (ownUserId === id) {
        throw new BadRequestException("Not allowed to change own verified status");
      }

      const isRootUser = await this.userService.isUserRootUser(id);
      if (!isRootUser) {
        throw new BadRequestException("Not allowed to change root user to unverified");
      }
    }
    const { isVerified } = await validateInput(req.body, {
      isVerified: "required|boolean",
    });
    await this.userService.setVerifiedById(id, isVerified);
    res.send();
  }

  async setRootUser(req: Request, res: Response) {
    const { id } = await validateInput(req.params, idRules);

    const userId = req.user?.id;
    if (req.user?.id) {
      const isRootUser = await this.userService.isUserRootUser(userId);
      if (!isRootUser) {
        throw new AuthorizationError({
          permissions: [],
          roles: ["OWNER"],
          reason: "Not allowed to change owner (root user) without being owner yourself",
        });
      }
    }
    const { isRootUser } = await validateInput(req.body, {
      isRootUser: "required|boolean",
    });
    await this.userService.setIsRootUserById(id, isRootUser);
    res.send();
  }

  throwIfDemoMode() {
    const isDemoMode = this.configService.isDemoMode();
    if (isDemoMode) {
      throw new InternalServerException("Not allowed in demo mode");
    }
  }
}

export default createController(UserController)
  .prefix(AppConstants.apiRoute + "/user")
  .before([authenticate()])
  .get("/", "list", {
    before: [authorizeRoles([ROLES.ADMIN])],
  })
  .get("/roles", "listRoles", {})
  .get("/profile", "profile")
  .get("/:id", "get", {
    before: [authorizeRoles([ROLES.ADMIN])],
  })
  .delete("/:id", "delete", {
    before: [authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed],
  })
  // Has root user validation
  .post("/:id/set-root-user", "setRootUser", {
    before: [demoUserNotAllowed],
  })
  .post("/:id/set-verified", "setVerified", {
    before: [authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed],
  })
  .post("/:id/change-username", "changeUsername", demoUserNotAllowedInterceptor)
  .post("/:id/change-password", "changePassword", demoUserNotAllowedInterceptor);
