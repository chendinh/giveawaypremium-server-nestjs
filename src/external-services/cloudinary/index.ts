import { v2 as cloudinaryV2 } from 'cloudinary';
import { cloudinaryConfigs } from '../../config/cloudinary.config';

cloudinaryV2.config(cloudinaryConfigs);

export { cloudinaryV2 };
